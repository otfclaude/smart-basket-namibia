"""Sample shelf prices and weekly specials so the app is usable before real data is loaded.

Everything written here has source='sample' and the UI labels it as sample data. Rows from
imports, feeds or community reports always take priority: sample rows are only created for
shop/product pairs that have no real price, and are regenerated each week so the specials rotate.
"""
from __future__ import annotations

import json
import random
from datetime import date, timedelta

from .db import get_setting, set_setting, stamp, today

# Relative price level per shop (1.0 = typical). Illustrative only.
STORE_INDEX = {"usave": 0.95, "shoprite": 0.96, "metrohyper": 0.95, "choppies": 0.97, "picknpay": 0.99,
               "woermannbrock": 0.99, "checkers": 1.01, "okfoods": 1.02, "foodlovers": 1.02,
               "clicks": 1.03, "spar": 1.05, "woolworths": 1.15}
CATEGORY_INDEX = {("foodlovers", "Fruit & veg"): 0.86, ("metrohyper", "Staples & grains"): 0.95,
                  ("woolworths", "Fruit & veg"): 1.05}
LABELS = ["Weekly special", "Weekly special", "Weekend deal", "Month-end saver", "Combo deal",
          "Lowest price", "Bulk buy saver", "Clearance"]
SPECIAL_SHARE = 0.22


def week_key(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def shelf_round(x: float) -> float:
    """Shop-style price ending in .49 / .99."""
    return max(0.99, round(x * 2) / 2 - 0.01)


def enabled(conn) -> bool:
    return get_setting(conn, "sample_data", "on") == "on"


def set_enabled(conn, on: bool):
    set_setting(conn, "sample_data", "on" if on else "off")
    set_setting(conn, "sample_week", "")
    ensure_sample(conn)


def ensure_sample(conn, force: bool = False, on: date | None = None) -> int:
    """(Re)generate this week's sample prices. Returns the number of sample rows written."""
    d = on or today()
    wk = week_key(d)
    if not enabled(conn):
        conn.execute("DELETE FROM prices WHERE source = 'sample'")
        conn.commit()
        return 0
    if not force and get_setting(conn, "sample_week") == wk:
        return 0
    conn.execute("DELETE FROM prices WHERE source = 'sample'")
    taken = {(r[0], r[1]) for r in conn.execute("SELECT store_id, product_id FROM prices")}
    stores = conn.execute("SELECT id, sells FROM stores").fetchall()
    products = conn.execute(
        "SELECT p.id, p.factor, i.base, i.category FROM products p JOIN items i ON i.id = p.item_id "
        "WHERE i.base IS NOT NULL").fetchall()
    monday = d - timedelta(days=d.weekday())
    month_end = (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    rows, ts = [], stamp()
    for s in stores:
        sells = set(json.loads(s["sells"]))
        for p in products:
            if (s["id"], p["id"]) in taken or (sells and p["category"] not in sells):
                continue
            if random.Random(f"stock|{s['id']}|{p['id']}").random() > 0.86:
                continue  # this shop doesn't stock this product
            rng = random.Random(f"{wk}|{s['id']}|{p['id']}")
            level = STORE_INDEX.get(s["id"], 1.0) * CATEGORY_INDEX.get((s["id"], p["category"]), 1.0)
            price = shelf_round(p["base"] * p["factor"] * level * (1 + rng.gauss(0, 0.035)))
            special = label = until = None
            if rng.random() < SPECIAL_SHARE:
                special = shelf_round(price * (1 - rng.uniform(0.08, 0.30)))
                if special >= price:
                    special = None
                else:
                    label = rng.choice(LABELS)
                    until = month_end if label == "Month-end saver" else monday + timedelta(
                        days=rng.choice([6, 6, 6, 9]))
                    if until < d:
                        until = monday + timedelta(days=6)
            rows.append((s["id"], p["id"], price, special, label, monday.isoformat() if special else None,
                         until.isoformat() if until else None, "sample", ts))
    conn.executemany(
        "INSERT INTO prices(store_id, product_id, price, special_price, special_label, valid_from, "
        "valid_until, source, updated_at) VALUES(?,?,?,?,?,?,?,?,?)", rows)
    set_setting(conn, "sample_week", wk)
    conn.commit()
    return len(rows)
