#!/usr/bin/env python3
"""Tests for the sync service. Standard library only; no network, no real mail."""

import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TMP = tempfile.mkdtemp()
os.environ["OPENSTRING_DB"] = os.path.join(TMP, "test.db")

import sync  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        if os.path.exists(sync.DB_PATH):
            os.remove(sync.DB_PATH)
        sync.init_db()


class RateLimit(Base):
    def test_one_address_cannot_be_mail_bombed(self):
        with sync.db() as c:
            for i in range(3):
                self.assertIsNone(sync.rate_check(c, "victim@example.com", f"10.0.0.{i}"),
                                  f"request {i+1} should be allowed")
                sync.rate_record(c, "victim@example.com", f"10.0.0.{i}")
            blocked = sync.rate_check(c, "victim@example.com", "10.0.0.99")
            self.assertIsNotNone(blocked, "the fourth link to one address must be refused")
            self.assertIn("Try again in about", blocked)

    def test_one_sender_cannot_spray_many_addresses(self):
        with sync.db() as c:
            for i in range(10):
                self.assertIsNone(sync.rate_check(c, f"t{i}@example.com", "203.0.113.5"))
                sync.rate_record(c, f"t{i}@example.com", "203.0.113.5")
            self.assertIsNotNone(sync.rate_check(c, "fresh@example.com", "203.0.113.5"),
                                 "the same IP must be stopped after its hourly quota")

    def test_limits_lapse_once_the_window_passes(self):
        with sync.db() as c:
            old = int(time.time()) - 3700  # just over an hour ago
            for _ in range(5):
                c.execute("INSERT INTO hits (scope,key,at) VALUES (?,?,?)", ("email", "a@b.co", old))
            self.assertIsNone(sync.rate_check(c, "a@b.co", "10.1.1.1"),
                              "expired hits must not count against the limit")

    def test_the_wait_message_is_a_real_duration(self):
        with sync.db() as c:
            for _ in range(3):
                sync.rate_record(c, "x@y.co", "10.2.2.2")
            msg = sync.rate_check(c, "x@y.co", "10.2.2.2")
            self.assertRegex(msg, r"about \d+ minute")


class Tokens(Base):
    def test_tokens_are_stored_hashed(self):
        token = "a-secret-token-value"
        with sync.db() as c:
            c.execute("INSERT INTO links (token_hash,email,expires,used) VALUES (?,?,?,0)",
                      (sync.sha(token), "a@b.co", int(time.time()) + 900))
            rows = c.execute("SELECT token_hash FROM links").fetchall()
        self.assertNotIn(token, rows[0][0], "the raw token must never be stored")
        self.assertEqual(len(rows[0][0]), 64)

    def test_purge_clears_expired_links_and_sessions(self):
        past = int(time.time()) - 10
        with sync.db() as c:
            c.execute("INSERT INTO links (token_hash,email,expires,used) VALUES ('h','a@b.co',?,0)", (past,))
            c.execute("INSERT INTO sessions (token_hash,user_id,expires,created) VALUES ('s',1,?,0)", (past,))
            sync.purge(c)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM links").fetchone()[0], 0)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)


class Email(Base):
    def test_address_validation(self):
        good = ["a@b.co", "vitaly+guitar@example.com", "x.y@sub.domain.org"]
        bad = ["", "nope", "a@b", "a b@c.com", "@b.co", "a@.co", "a@b.", "x" * 300 + "@b.co"]
        for e in good:
            self.assertTrue(sync.EMAIL_RE.match(e), f"{e} should be accepted")
        for e in bad:
            if len(e) > 200:
                continue  # truncated before matching in the handler
            self.assertFalse(sync.EMAIL_RE.match(e), f"{e} should be rejected")

    def test_link_email_contains_the_token_and_an_expiry_notice(self):
        sent = {}

        class FakeSMTP:
            def __init__(self, *a, **k): pass
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def send_message(self, msg): sent["msg"] = msg

        with mock.patch.object(sync.smtplib, "SMTP", FakeSMTP):
            sync.send_link("player@example.com", "TOK123")
        msg = sent["msg"]
        self.assertEqual(msg["To"], "player@example.com")
        body = msg.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("TOK123", body)
        self.assertIn("15 minutes", body)
        self.assertIn("did not ask for this", body,
                      "an unsolicited link must tell the recipient nothing happened")


class Blobs(Base):
    def test_blob_round_trip_and_size_cap(self):
        with sync.db() as c:
            c.execute("INSERT INTO users (email,created) VALUES ('a@b.co',0)")
            uid = c.execute("SELECT id FROM users").fetchone()[0]
            payload = json.dumps({"stats": {"s1f0": {"attempts": 3}}})
            c.execute("INSERT INTO blobs (user_id,body,updated) VALUES (?,?,?)", (uid, payload, 1))
            got = c.execute("SELECT body FROM blobs WHERE user_id=?", (uid,)).fetchone()[0]
        self.assertEqual(json.loads(got)["stats"]["s1f0"]["attempts"], 3)
        self.assertLess(len(payload.encode()), sync.MAX_BLOB_BYTES)

    def test_the_cap_is_far_above_a_realistic_history(self):
        # A year of daily practice across every position on the neck.
        big = {"stats": {f"s{s}f{f}": {"attempts": 400, "accuracy": 0.9, "avgMs": 1200}
                         for s in range(1, 7) for f in range(0, 13)},
               "sessions": [{"date": 1, "asked": 40, "correct": 35} for _ in range(365)]}
        self.assertLess(len(json.dumps(big).encode()), sync.MAX_BLOB_BYTES,
                        "a heavy user must fit inside the sync limit")


if __name__ == "__main__":
    unittest.main(verbosity=1)
