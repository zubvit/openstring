#!/usr/bin/env python3
"""
Openstring sync: magic-link sign-in and one blob of practice progress per person.

Design constraints that shaped this:

  * No passwords, ever. A magic link means there is no credential to steal, reset,
    reuse across sites, or leak. The cost is that email deliverability becomes the
    login path, which is acceptable when you run your own mail server.

  * Bearer tokens in localStorage, NOT cookies. The app is served from
    openstring.app and this API lives on sync.openstring.app, so a cookie would be
    cross-site - and cross-site cookies are actively being killed by browsers.
    A bearer token sidesteps that whole category of breakage.

  * The server stores an opaque blob. It never parses progress, so it holds no
    behavioural data it could leak or be asked to hand over. Email address plus
    an opaque blob is the entire dataset.

  * Local-first stays true: this is an optional extra. If this service is down,
    missing, or never contacted, the app works exactly as before.

Standard library only - no pip install on the box.
"""

import contextlib
import hashlib
import json
import os
import re
import secrets
import smtplib
import sqlite3
import sys
import time
from email.message import EmailMessage
from email.utils import formataddr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# --------------------------------------------------------------------- config

DB_PATH = os.environ.get("OPENSTRING_DB", "/var/lib/openstring/sync.db")
BIND_HOST = os.environ.get("OPENSTRING_HOST", "127.0.0.1")
BIND_PORT = int(os.environ.get("OPENSTRING_PORT", "8791"))
APP_ORIGIN = os.environ.get("OPENSTRING_APP_ORIGIN", "https://openstring.app")
API_BASE = os.environ.get("OPENSTRING_API_BASE", "https://sync.openstring.app")
MAIL_HOST = os.environ.get("OPENSTRING_SMTP_HOST", "127.0.0.1")
MAIL_PORT = int(os.environ.get("OPENSTRING_SMTP_PORT", "25"))
MAIL_FROM = os.environ.get("OPENSTRING_MAIL_FROM", "openstring@openstring.app")
MAIL_NAME = os.environ.get("OPENSTRING_MAIL_NAME", "Openstring")

MAX_BLOB_BYTES = 512 * 1024        # a lifetime of practice stats is a few KB
LINK_TTL = 15 * 60                 # a magic link is valid for 15 minutes
SESSION_TTL = 400 * 24 * 3600      # signing in lasts about a year
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

# Anti-spam. A magic-link endpoint is an open invitation to mail-bomb a stranger
# unless it is bounded on BOTH axes: how often one address can be targeted, and
# how many addresses one sender can target.
LIMITS = [
    ("email", 3, 3600),      # 3 links to one address per hour
    ("email", 8, 86400),     # and 8 per day
    ("ip", 10, 3600),        # 10 requests from one address per hour
    ("ip", 40, 86400),
    ("global", 500, 3600),   # a backstop so a botnet cannot burn the mail reputation
]

# ------------------------------------------------------------------- database


@contextlib.contextmanager
def db():
    """
    Transaction AND connection lifetime.

    `with sqlite3.connect(...)` only manages the transaction - it commits, but it
    never closes. In a long-running server that leaks a file descriptor per
    request until the process runs out and dies, which looks like a mystery
    outage days later.
    """
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        with conn:
            yield conn
    finally:
        conn.close()


def init_db():
    with db() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS links (
                token_hash TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                expires INTEGER NOT NULL,
                used INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires INTEGER NOT NULL,
                created INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS blobs (
                user_id INTEGER PRIMARY KEY,
                body TEXT NOT NULL,
                updated INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hits (
                scope TEXT NOT NULL,
                key TEXT NOT NULL,
                at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS hits_lookup ON hits(scope, key, at);
            CREATE INDEX IF NOT EXISTS links_expiry ON links(expires);
            """
        )


def sha(value: str) -> str:
    # Tokens are stored hashed: a stolen database backup must not be a set of
    # working credentials.
    return hashlib.sha256(value.encode()).hexdigest()


def purge(conn):
    now = int(time.time())
    conn.execute("DELETE FROM links WHERE expires < ?", (now,))
    conn.execute("DELETE FROM sessions WHERE expires < ?", (now,))
    conn.execute("DELETE FROM hits WHERE at < ?", (now - 86400,))


# ------------------------------------------------------------------ rate limit


def rate_check(conn, email, ip):
    """Return None if allowed, else a human sentence explaining the wait."""
    now = int(time.time())
    for scope, limit, window in LIMITS:
        key = {"email": email, "ip": ip, "global": "-"}[scope]
        n = conn.execute(
            "SELECT COUNT(*) FROM hits WHERE scope=? AND key=? AND at > ?",
            (scope, key, now - window),
        ).fetchone()[0]
        if n >= limit:
            oldest = conn.execute(
                "SELECT MIN(at) FROM hits WHERE scope=? AND key=? AND at > ?",
                (scope, key, now - window),
            ).fetchone()[0]
            wait = max(60, (oldest + window) - now)
            mins = max(1, round(wait / 60))
            return f"Too many sign-in emails have been requested. Try again in about {mins} minute{'s' if mins != 1 else ''}."
    return None


def rate_record(conn, email, ip):
    now = int(time.time())
    conn.executemany(
        "INSERT INTO hits (scope, key, at) VALUES (?,?,?)",
        [("email", email, now), ("ip", ip, now), ("global", "-", now)],
    )


# ------------------------------------------------------------------------ mail


def send_link(email, token):
    link = f"{API_BASE}/api/verify?t={token}"
    msg = EmailMessage()
    msg["Subject"] = "Your Openstring sign-in link"
    msg["From"] = formataddr((MAIL_NAME, MAIL_FROM))
    msg["To"] = email
    msg.set_content(
        "Here is your sign-in link for Openstring:\n\n"
        f"{link}\n\n"
        "It works once and expires in 15 minutes.\n\n"
        "If you did not ask for this, ignore it - nothing has happened to your "
        "practice history, and no account has been created.\n"
    )
    msg.add_alternative(
        f"""<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1d1c1a">
<p>Here is your sign-in link for Openstring:</p>
<p><a href="{link}" style="background:#2f6f4f;color:#fff;padding:.6rem 1rem;border-radius:8px;text-decoration:none">Sign in</a></p>
<p style="color:#5d5a54;font-size:.9em">It works once and expires in 15 minutes.<br>
If you did not ask for this, ignore it &mdash; nothing has happened to your practice
history, and no account has been created.</p>
</body></html>""",
        subtype="html",
    )
    with smtplib.SMTP(MAIL_HOST, MAIL_PORT, timeout=20) as s:
        s.send_message(msg)


# ---------------------------------------------------------------------- server


class Handler(BaseHTTPRequestHandler):
    server_version = "openstring-sync"

    def log_message(self, fmt, *args):
        # Deliberately does not log email addresses or tokens.
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers

    def client_ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return (fwd.split(",")[0].strip() if fwd else self.client_address[0])[:64]

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", APP_ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS")

    def reply(self, code, payload, ctype="application/json"):
        body = (json.dumps(payload) if ctype == "application/json" else payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    # Absolute ceiling on what we will even read off the wire before hanging up.
    HARD_LIMIT = 8 * 1024 * 1024

    def body_json(self, limit=MAX_BLOB_BYTES + 4096):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return None
        if n > limit:
            # Drain before replying. Answering while the client is still uploading
            # makes the connection reset, so the caller sees a network error
            # instead of the clear "too big" message we are trying to give them.
            if n <= self.HARD_LIMIT:
                remaining = n
                while remaining > 0:
                    chunk = self.rfile.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            else:
                self.close_connection = True
            return "TOO_BIG"
        try:
            return json.loads(self.rfile.read(n).decode())
        except Exception:
            return None

    def session_user(self, conn):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        row = conn.execute(
            "SELECT user_id, expires FROM sessions WHERE token_hash=?",
            (sha(auth[7:].strip()),),
        ).fetchone()
        if not row or row[1] < int(time.time()):
            return None
        return row[0]

    # -- routes

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/request":
            return self.request_link()
        if path == "/api/signout":
            return self.signout()
        self.reply(404, {"error": "not found"})

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/verify":
            return self.verify()
        if path == "/api/data":
            return self.get_data()
        if path == "/api/health":
            return self.reply(200, {"ok": True})
        self.reply(404, {"error": "not found"})

    def do_PUT(self):
        if urlparse(self.path).path == "/api/data":
            return self.put_data()
        self.reply(404, {"error": "not found"})

    def request_link(self):
        data = self.body_json(limit=4096)
        if data == "TOO_BIG":
            return self.reply(413, {"error": "That request is too large."})
        data = data or {}
        email = str(data.get("email", "")).strip().lower()[:200]
        if not EMAIL_RE.match(email):
            return self.reply(400, {"error": "That does not look like an email address."})

        ip = self.client_ip()
        with db() as conn:
            purge(conn)
            blocked = rate_check(conn, email, ip)
            if blocked:
                return self.reply(429, {"error": blocked})
            rate_record(conn, email, ip)

            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT OR REPLACE INTO links (token_hash, email, expires, used) VALUES (?,?,?,0)",
                (sha(token), email, int(time.time()) + LINK_TTL),
            )

        try:
            send_link(email, token)
        except Exception as e:
            sys.stderr.write(f"mail failed: {type(e).__name__}\n")
            return self.reply(502, {"error": "The sign-in email could not be sent. Try again shortly."})

        # Always the same answer, whether or not this address has been seen before:
        # otherwise this endpoint becomes a way to test who has an account.
        self.reply(200, {"ok": True, "message": "Check your email for a sign-in link."})

    def verify(self):
        token = (parse_qs(urlparse(self.path).query).get("t") or [""])[0]
        if not token:
            return self.reply(400, {"error": "missing token"})
        now = int(time.time())
        with db() as conn:
            purge(conn)
            row = conn.execute(
                "SELECT email, expires, used FROM links WHERE token_hash=?", (sha(token),)
            ).fetchone()
            if not row or row[2] or row[1] < now:
                return self.reply(
                    400,
                    "<p style='font-family:system-ui'>That sign-in link has expired or was already used. "
                    "Ask for a new one from the app.</p>",
                    ctype="text/html; charset=utf-8",
                )
            email = row[0]
            conn.execute("UPDATE links SET used=1 WHERE token_hash=?", (sha(token),))
            conn.execute(
                "INSERT OR IGNORE INTO users (email, created) VALUES (?,?)", (email, now)
            )
            uid = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()[0]
            session = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires, created) VALUES (?,?,?,?)",
                (sha(session), uid, now + SESSION_TTL, now),
            )

        # Hand the session back through the URL fragment: fragments are not sent to
        # servers and do not land in proxy or referrer logs.
        self.send_response(302)
        self.send_header("Location", f"{APP_ORIGIN}/#sync={session}")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()

    def get_data(self):
        with db() as conn:
            uid = self.session_user(conn)
            if not uid:
                return self.reply(401, {"error": "not signed in"})
            row = conn.execute("SELECT body, updated FROM blobs WHERE user_id=?", (uid,)).fetchone()
        if not row:
            return self.reply(200, {"data": None, "updated": 0})
        self.reply(200, {"data": json.loads(row[0]), "updated": row[1]})

    def put_data(self):
        payload = self.body_json()
        if payload == "TOO_BIG":
            return self.reply(413, {"error": "That is larger than the sync limit."})
        if payload is None or "data" not in payload:
            return self.reply(400, {"error": "expected a JSON body with a data field"})
        body = json.dumps(payload["data"])
        if len(body.encode()) > MAX_BLOB_BYTES:
            return self.reply(413, {"error": "That is larger than the sync limit."})
        with db() as conn:
            uid = self.session_user(conn)
            if not uid:
                return self.reply(401, {"error": "not signed in"})
            now = int(time.time())
            conn.execute(
                "INSERT INTO blobs (user_id, body, updated) VALUES (?,?,?) "
                "ON CONFLICT(user_id) DO UPDATE SET body=excluded.body, updated=excluded.updated",
                (uid, body, now),
            )
        self.reply(200, {"ok": True, "updated": now})

    def signout(self):
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (sha(auth[7:].strip()),))
        self.reply(200, {"ok": True})


def main():
    init_db()
    srv = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    sys.stderr.write(f"openstring-sync listening on {BIND_HOST}:{BIND_PORT}\n")
    srv.serve_forever()


if __name__ == "__main__":
    main()
