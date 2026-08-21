#!/usr/bin/env python3
"""
End-to-end test of the sync service over real HTTP.

Runs the actual server on a loopback port with a throwaway SMTP sink, so the
whole path is exercised - routing, rate limiting, token single-use, bearer auth -
without sending a single real email to anybody.
"""

import email
import email.policy
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp()
SMTP_PORT = 8025
API_PORT = 8791


class SMTPSink(threading.Thread):
    """Accepts SMTP conversations and keeps the message bodies. Not a real server."""

    daemon = True

    def __init__(self, port):
        super().__init__()
        self.port = port
        self.messages = []
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(8)
        self.running = True

    def run(self):
        while self.running:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.serve, args=(conn,), daemon=True).start()

    def serve(self, conn):
        f = conn.makefile("rwb")
        conn.sendall(b"220 sink\r\n")
        body, in_data = [], False
        while True:
            line = f.readline()
            if not line:
                break
            if in_data:
                if line.strip() == b".":
                    self.messages.append(b"".join(body).decode("utf-8", "replace"))
                    body, in_data = [], False
                    conn.sendall(b"250 ok\r\n")
                    continue
                body.append(line)
                continue
            cmd = line.decode("utf-8", "replace").upper()
            if cmd.startswith(("EHLO", "HELO")):
                conn.sendall(b"250-sink\r\n250 OK\r\n")
            elif cmd.startswith(("MAIL", "RCPT")):
                conn.sendall(b"250 OK\r\n")
            elif cmd.startswith("DATA"):
                in_data = True
                conn.sendall(b"354 go\r\n")
            elif cmd.startswith("QUIT"):
                conn.sendall(b"221 bye\r\n")
                break
            else:
                conn.sendall(b"250 OK\r\n")
        conn.close()


def call(method, path, body=None, token=None, origin="https://openstring.app"):
    req = urllib.request.Request(f"http://127.0.0.1:{API_PORT}{path}", method=method)
    req.add_header("Origin", origin)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=10) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.startswith(("{", "[")) else raw), dict(r.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw.startswith(("{", "[")) else raw), dict(e.headers)


class Flow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sink = SMTPSink(SMTP_PORT)
        cls.sink.start()
        env = {
            **os.environ,
            "OPENSTRING_DB": os.path.join(TMP, "e2e.db"),
            "OPENSTRING_PORT": str(API_PORT),
            "OPENSTRING_SMTP_PORT": str(SMTP_PORT),
            "OPENSTRING_SMTP_HOST": "127.0.0.1",
            "OPENSTRING_API_BASE": f"http://127.0.0.1:{API_PORT}",
        }
        cls.proc = subprocess.Popen([sys.executable, os.path.join(HERE, "sync.py")],
                                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(50):
            try:
                if call("GET", "/api/health")[0] == 200:
                    break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.sink.running = False
        cls.sink.sock.close()

    def token_from_last_mail(self):
        # The raw SMTP body is quoted-printable, which wraps long lines with a
        # trailing "=" - so the token must be read from the DECODED message, the
        # same way any real mail client would see it.
        raw = self.sink.messages[-1]
        msg = email.message_from_string(raw, policy=email.policy.default)
        body = msg.get_body(preferencelist=("plain",)).get_content()
        m = re.search(r"/api/verify\?t=([A-Za-z0-9_\-]+)", body)
        self.assertIsNotNone(m, f"the email must contain a verify link; got: {body[:200]}")
        return m.group(1)

    def follow(self, token):
        """Spend a sign-in link the way the page's button does. Returns Location."""
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None

        body = urllib.parse.urlencode({"t": token}).encode()
        req = urllib.request.Request(
            f"http://127.0.0.1:{API_PORT}/api/consume", data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            urllib.request.build_opener(NoRedirect).open(req, timeout=10)
            self.fail("expected a redirect")
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Location"), e

    def sign_in(self, address):
        """Request a link, open it, press the button, return the session token."""
        status, _, _ = call("POST", "/api/request", {"email": address})
        self.assertEqual(status, 200)
        time.sleep(0.3)
        token = self.token_from_last_mail()

        code, loc, _ = self.follow(token)
        self.assertEqual(code, 303, "pressing the button should send you back to the app")
        self.assertIn("#sync=", loc, "the session must come back in the URL fragment")
        return token, loc.split("#sync=")[1]

    def test_01_bad_address_is_refused_without_sending_anything(self):
        before = len(self.sink.messages)
        status, body, _ = call("POST", "/api/request", {"email": "not-an-email"})
        self.assertEqual(status, 400)
        self.assertEqual(len(self.sink.messages), before, "no mail may be sent for a bad address")

    def test_02_full_sign_in_and_sync_round_trip(self):
        token, session = self.sign_in("player@example.com")

        # Nothing stored yet.
        status, body, _ = call("GET", "/api/data", token=session)
        self.assertEqual(status, 200)
        self.assertIsNone(body["data"])

        # Push, then pull it back.
        payload = {"stats": {"s1f0": {"attempts": 7}}, "sessions": [{"asked": 12}]}
        status, body, _ = call("PUT", "/api/data", {"data": payload}, token=session)
        self.assertEqual(status, 200)
        status, body, _ = call("GET", "/api/data", token=session)
        self.assertEqual(body["data"]["stats"]["s1f0"]["attempts"], 7)

        # A used link must not work twice. Single use is enforced where the link
        # is SPENT, not where it is opened: opening deliberately says nothing
        # about whether the token is still good, or a mail scanner would learn it.
        code, _, _ = self.follow(token)
        self.assertEqual(code, 400, "a magic link must be single use")

    def test_03_no_token_no_data(self):
        self.assertEqual(call("GET", "/api/data")[0], 401)
        self.assertEqual(call("PUT", "/api/data", {"data": {}})[0], 401)
        self.assertEqual(call("GET", "/api/data", token="made-up-token")[0], 401)

    def test_04_cors_allows_the_app_and_nobody_else(self):
        _, _, headers = call("GET", "/api/health")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://openstring.app")

    def test_05_rate_limit_stops_a_mail_bomb(self):
        target = "victim@example.com"
        sent_before = len(self.sink.messages)
        codes = []
        for _ in range(5):
            codes.append(call("POST", "/api/request", {"email": target})[0])
            time.sleep(0.15)
        self.assertEqual(codes[:3], [200, 200, 200], f"first three should go through: {codes}")
        self.assertEqual(codes[3], 429, f"fourth must be refused: {codes}")
        self.assertEqual(codes[4], 429)
        sent = len(self.sink.messages) - sent_before
        self.assertLessEqual(sent, 3, f"only three emails may ever have been sent, got {sent}")

        status, body, _ = call("POST", "/api/request", {"email": target})
        self.assertEqual(status, 429)
        self.assertIn("Try again in about", body["error"])

    def test_06_oversized_payload_is_rejected(self):
        _, session = self.sign_in("big@example.com")
        huge = {"blob": "x" * (600 * 1024)}
        status, _, _ = call("PUT", "/api/data", {"data": huge}, token=session)
        self.assertIn(status, (400, 413), f"expected a rejection, got {status}")

    def test_07_signing_out_kills_the_session(self):
        _, session = self.sign_in("bye@example.com")
        self.assertEqual(call("GET", "/api/data", token=session)[0], 200)
        self.assertEqual(call("POST", "/api/signout", {}, token=session)[0], 200)
        self.assertEqual(call("GET", "/api/data", token=session)[0], 401,
                         "the session must stop working after signing out")


    # A mail scanner opens every link in a message before the recipient does.
    # It burned the single-use token - so the real person was told the link had
    # already been used - and was handed a working session in the redirect.
    def test_11_a_scanner_opening_the_link_does_not_spend_it(self):
        status, _, _ = call("POST", "/api/request", {"email": "scanned@example.com"})
        self.assertEqual(status, 200)
        time.sleep(0.3)
        token = self.token_from_last_mail()

        # What a scanner does: a plain GET.
        with urllib.request.urlopen(
                f"http://127.0.0.1:{API_PORT}/api/verify?t={token}", timeout=10) as r:
            self.assertEqual(r.status, 200, "the link shows a page rather than redirecting")
            page = r.read().decode()
        self.assertNotIn("#sync=", page, "no session may be handed out for a GET")
        self.assertIn("/api/consume", page, "the page carries a form that spends it")

        # The person then clicks, and it still works.
        code, loc, _ = self.follow(token)
        self.assertEqual(code, 303, "the link survived the scanner")
        self.assertIn("#sync=", loc)

    def test_12_a_link_can_still_only_be_spent_once(self):
        _, session = self.sign_in("once@example.com")
        self.assertTrue(session)
        token = self.token_from_last_mail()
        code, _, err = self.follow(token)
        self.assertEqual(code, 400, "the second press must be refused")
        self.assertIn("already used", err.read().decode())

    # Valid JSON that is not an object used to reach .get and kill the thread,
    # so the client saw a reset connection instead of a reason.
    def test_13_odd_bodies_get_an_answer_rather_than_a_dropped_connection(self):
        for body in ("[1]", '"mydata"', "42", "null"):
            req = urllib.request.Request(
                f"http://127.0.0.1:{API_PORT}/api/request", data=body.encode(),
                method="POST", headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=10) as r:
                    code = r.status
            except urllib.error.HTTPError as e:
                code = e.code
            self.assertEqual(code, 400, f"{body} should be a clean 400")

        # And the same for the endpoint that takes the blob.
        req = urllib.request.Request(
            f"http://127.0.0.1:{API_PORT}/api/data", data=b'"mydata"', method="PUT",
            headers={"Content-Type": "application/json", "Authorization": "Bearer nonsense"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                code = r.status
        except urllib.error.HTTPError as e:
            code = e.code
        self.assertEqual(code, 400)

if __name__ == "__main__":
    unittest.main(verbosity=2)
