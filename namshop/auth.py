"""User accounts: password hashing (PBKDF2-SHA256) and cookie sessions."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import timedelta

from .db import now, stamp

ITERATIONS = int(os.environ.get("NAMSHOP_PBKDF2_ITERATIONS", "260000"))
SESSION_DAYS = 30
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthError(ValueError):
    pass


def hash_password(password: str, iterations: int = ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(iterations, base64.b64encode(salt).decode(),
                                           base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), int(iters))
        return hmac.compare_digest(dk, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(row) -> dict | None:
    if row is None:
        return None
    return {"id": row["id"], "name": row["name"], "email": row["email"], "town": row["town"],
            "stores": json.loads(row["stores"] or "[]"), "is_admin": bool(row["is_admin"])}


def register(conn, name: str, email: str, password: str, town: str = "") -> dict:
    name, email, town = (name or "").strip(), (email or "").strip().lower(), (town or "").strip()
    if not 1 <= len(name) <= 60:
        raise AuthError("Please enter your name (up to 60 characters).")
    if not EMAIL_RE.match(email) or len(email) > 120:
        raise AuthError("Please enter a valid email address.")
    if len(password or "") < 8:
        raise AuthError("Password must be at least 8 characters.")
    if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        raise AuthError("An account with this email already exists. Sign in instead.")
    cur = conn.execute("INSERT INTO users(email, name, pw_hash, town, created_at) VALUES(?,?,?,?,?)",
                       (email, name, hash_password(password), town[:60], stamp()))
    conn.commit()
    return public_user(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


class _Throttle:
    """Slows down password guessing: max 8 failures per email per 15 minutes."""
    WINDOW, LIMIT = 900, 8

    def __init__(self):
        self.fails: dict[str, list[float]] = {}

    def check(self, key: str):
        recent = [t for t in self.fails.get(key, []) if time.time() - t < self.WINDOW]
        self.fails[key] = recent
        if len(recent) >= self.LIMIT:
            raise AuthError("Too many failed sign-in attempts. Please wait 15 minutes and try again.")

    def fail(self, key: str):
        self.fails.setdefault(key, []).append(time.time())

    def clear(self, key: str):
        self.fails.pop(key, None)


throttle = _Throttle()


def login(conn, email: str, password: str) -> dict:
    email = (email or "").strip().lower()
    throttle.check(email)
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if row is None or not verify_password(password or "", row["pw_hash"]):
        throttle.fail(email)
        raise AuthError("Email or password is incorrect.")
    throttle.clear(email)
    return public_user(row)


def new_session(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (now() + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (stamp(),))
    conn.execute("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)",
                 (_token_hash(token), user_id, expires))
    conn.commit()
    return token


def user_for_token(conn, token: str | None):
    if not token:
        return None
    return conn.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = ? AND s.expires_at > ?", (_token_hash(token), stamp())).fetchone()


def end_session(conn, token: str | None):
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
        conn.commit()


def change_password(conn, user_id: int, old: str, new: str):
    row = conn.execute("SELECT pw_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None or not verify_password(old or "", row["pw_hash"]):
        raise AuthError("Current password is incorrect.")
    if len(new or "") < 8:
        raise AuthError("New password must be at least 8 characters.")
    conn.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (hash_password(new), user_id))
    conn.commit()


def make_admin(conn, email: str) -> bool:
    cur = conn.execute("UPDATE users SET is_admin = 1 WHERE email = ?", (email.strip().lower(),))
    conn.commit()
    return cur.rowcount > 0
