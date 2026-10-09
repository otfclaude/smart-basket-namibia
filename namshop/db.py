"""SQLite storage: schema, connection and seeding of shops and the product catalogue."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import BUNDLED_DATA, data_dir

NAMIBIA_TZ = timezone(timedelta(hours=2))  # Central Africa Time, no daylight saving

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    town TEXT NOT NULL DEFAULT '',
    stores TEXT NOT NULL DEFAULT '[]',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS stores(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    grp TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    sells TEXT NOT NULL DEFAULT '[]',
    logo TEXT NOT NULL DEFAULT '{}',
    sort INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS items(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'each',
    qty REAL NOT NULL DEFAULT 1,
    category TEXT NOT NULL DEFAULT 'Other',
    keywords TEXT NOT NULL DEFAULT '',
    base REAL);

CREATE TABLE IF NOT EXISTS products(
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    brand TEXT NOT NULL,
    factor REAL NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS prices(
    id INTEGER PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    special_price REAL,
    special_label TEXT,
    valid_from TEXT,
    valid_until TEXT,
    source TEXT NOT NULL,
    reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    branch TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(store_id, product_id));
CREATE INDEX IF NOT EXISTS prices_product ON prices(product_id);

CREATE TABLE IF NOT EXISTS lists(
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS leaflets(
    id INTEGER PRIMARY KEY,
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL,
    page_url TEXT,
    kind TEXT NOT NULL,
    files TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    status TEXT NOT NULL,
    message TEXT,
    n_specials INTEGER NOT NULL DEFAULT 0,
    UNIQUE(store_id, sha256));

CREATE TABLE IF NOT EXISTS reports(
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    store_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price REAL,
    special_price REAL NOT NULL,
    special_label TEXT,
    valid_until TEXT,
    branch TEXT,
    created_at TEXT NOT NULL);
"""


def now() -> datetime:
    return datetime.now(NAMIBIA_TZ)


def today() -> date:
    return now().date()


def stamp() -> str:
    return now().isoformat(timespec="seconds")


def slug(*parts: str) -> str:
    s = "-".join(str(p) for p in parts if p)
    return re.sub(r"[^a-z0-9.]+", "-", s.lower().replace("'", "").replace("&", "and")).strip("-")


def product_id(item_id: str, brand: str) -> str:
    return f"{item_id}--{slug(brand)}"


def db_path() -> Path:
    return data_dir() / "namshop.db"


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path or db_path()), check_same_thread=False, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_setting(conn, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str):
    conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def _load_json(name: str):
    override = data_dir() / name   # an admin can replace the bundled shop list or catalogue
    path = override if override.exists() else BUNDLED_DATA / name
    return json.loads(path.read_text(encoding="utf-8"))


def init_db(conn: sqlite3.Connection):
    """Create tables and (re)load the shop registry and base catalogue. Safe to run on every start."""
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(stores)")}
    for col in ("website", "aliases"):
        if col not in cols:
            conn.execute(f"ALTER TABLE stores ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")
    registry = _load_json("stores.json")
    for i, s in enumerate(registry):
        conn.execute(
            "INSERT INTO stores(id, name, grp, kind, sells, logo, sort, website, aliases) VALUES(?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, grp=excluded.grp, kind=excluded.kind, "
            "sells=excluded.sells, logo=excluded.logo, sort=excluded.sort, website=excluded.website, "
            "aliases=excluded.aliases",
            (s["id"], s["name"], s.get("group", ""), s.get("kind", ""), json.dumps(s.get("sells", [])),
             json.dumps(s.get("logo", {})), i, s.get("website", ""), json.dumps(s.get("aliases", []))))
    keep = [s["id"] for s in registry]  # shops removed from the registry go, with their prices
    conn.execute(f"DELETE FROM stores WHERE id NOT IN ({','.join('?' * len(keep))})", keep)
    catalog = _load_json("catalog.json")
    for it in catalog["items"]:
        upsert_item(conn, it["id"], it["name"], size=it.get("size", ""), unit=it.get("unit", "each"),
                    qty=it.get("qty", 1), category=it.get("category", "Other"),
                    keywords=" ".join(it.get("keywords", [])), base=it.get("base"))
        for brand, factor in it.get("brands", []):
            upsert_product(conn, it["id"], brand, factor)
    set_setting(conn, "categories", json.dumps(catalog.get("categories", [])))
    conn.commit()


def upsert_item(conn, item_id, name, size="", unit="each", qty=1.0, category="Other", keywords="", base=None):
    conn.execute(
        "INSERT INTO items(id, name, size, unit, qty, category, keywords, base) VALUES(?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, size=excluded.size, unit=excluded.unit, "
        "qty=excluded.qty, category=excluded.category, keywords=excluded.keywords, "
        "base=COALESCE(excluded.base, items.base)",
        (item_id, name, size, unit, float(qty or 1), category, keywords, base))
    return item_id


def upsert_product(conn, item_id: str, brand: str, factor: float = 1.0) -> str:
    pid = product_id(item_id, brand)
    conn.execute("INSERT INTO products(id, item_id, brand, factor) VALUES(?,?,?,?) "
                 "ON CONFLICT(id) DO UPDATE SET brand=excluded.brand",
                 (pid, item_id, brand, factor))
    return pid


def stores(conn) -> list[dict]:
    out = []
    for r in conn.execute("SELECT * FROM stores ORDER BY sort, name"):
        out.append({"id": r["id"], "name": r["name"], "group": r["grp"], "kind": r["kind"],
                    "sells": json.loads(r["sells"]), "logo": json.loads(r["logo"]), "website": r["website"],
                    "aliases": json.loads(r["aliases"] or "[]")})
    return out


def categories(conn) -> list[str]:
    cats = json.loads(get_setting(conn, "categories", "[]"))
    extra = [r[0] for r in conn.execute("SELECT DISTINCT category FROM items ORDER BY category")
             if r[0] not in cats]
    return cats + extra
