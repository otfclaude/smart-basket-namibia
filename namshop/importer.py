"""Loading real prices and specials: CSV/JSON imports, remote feeds, and community reports.

Namibian retailers publish most specials as printed or PDF leaflets rather than open data, so
the app takes prices from three places:

* **Imports**: a CSV or JSON file (for example a leaflet typed up by an admin), via the admin
  page or ``python -m namshop import FILE``.
* **Feeds**: URLs listed in ``<data dir>/sources.json`` that return the same CSV/JSON format,
  fetched by ``python -m namshop refresh`` or the admin page (and periodically while serving).
* **Community reports**: signed-in shoppers report a special they saw in a shop.

Import columns (header names are case-insensitive; only ``store`` and a price are required):
store, product_id, item_id, item (or product/name), size, brand, category,
price (normal shelf price), special_price, special_label, valid_from, valid_until, branch
"""
from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
from datetime import date, datetime, timedelta

from . import data_dir
from .db import get_setting, product_id, set_setting, slug, stamp, today, upsert_item, upsert_product

ALIASES = {
    "store": ["store", "shop", "retailer", "store_id"],
    "product_id": ["product_id"],
    "item_id": ["item_id"],
    "item": ["item", "item_name", "product", "product_name", "name", "description"],
    "size": ["size", "pack_size"],
    "brand": ["brand"],
    "category": ["category"],
    "price": ["price", "regular_price", "normal_price", "was", "was_price", "shelf_price"],
    "special_price": ["special_price", "special", "promo_price", "sale_price", "now", "now_price"],
    "special_label": ["special_label", "label", "promo", "promotion", "deal"],
    "valid_from": ["valid_from", "from", "starts", "start_date"],
    "valid_until": ["valid_until", "until", "ends", "end_date", "expires", "valid_to"],
    "branch": ["branch", "town", "location"],
}
SIZE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litres?|liters?|pack|packs|s|rolls?|bags?|tray|'s)\b", re.I)
MAX_PRICE = 100_000


class ImportProblem(ValueError):
    pass


def _get(row: dict, field: str) -> str:
    for k in ALIASES[field]:
        v = row.get(k)
        if v not in (None, ""):
            return str(v).strip()
    return ""


def _money(text: str) -> float | None:
    if not text:
        return None
    t = re.sub(r"(?i)n\$|nad|r(?=\d)|\s", "", text).replace(",", ".")
    if t.count(".") > 1:  # 1.299.99 -> 1299.99
        head, _, tail = t.rpartition(".")
        t = head.replace(".", "") + "." + tail
    try:
        v = float(t)
    except ValueError:
        raise ImportProblem(f"'{text}' is not a price")
    if not 0 < v < MAX_PRICE:
        raise ImportProblem(f"price {v} is out of range")
    return round(v, 2)


def _date(text: str) -> str | None:
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    raise ImportProblem(f"'{text}' is not a date (use YYYY-MM-DD)")


def _size_info(size: str) -> tuple[str, float]:
    """'10kg' -> ('kg', 10); '750ml' -> ('L', 0.75); '18 pack' -> ('each', 18)."""
    m = SIZE_RE.search(size or "")
    if not m:
        return "each", 1.0
    n, u = float(m.group(1).replace(",", ".")), m.group(2).lower()
    if u == "kg":
        return "kg", n
    if u == "g":
        return "kg", n / 1000
    if u.startswith("l"):
        return "L", n
    if u == "ml":
        return "L", n / 1000
    return "each", n


def _resolve_store(conn, text: str) -> str:
    key = slug(text).replace("-", "")
    for r in conn.execute("SELECT id, name FROM stores"):
        if key in (r["id"], slug(r["name"]).replace("-", "")):
            return r["id"]
    raise ImportProblem(f"unknown shop '{text}'")


def _resolve_product(conn, row: dict) -> str:
    pid = _get(row, "product_id")
    if pid:
        if not conn.execute("SELECT 1 FROM products WHERE id = ?", (pid,)).fetchone():
            raise ImportProblem(f"unknown product_id '{pid}'")
        return pid
    brand = _get(row, "brand")
    item_id = _get(row, "item_id")
    if item_id:
        if not conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
            raise ImportProblem(f"unknown item_id '{item_id}'")
        return upsert_product(conn, item_id, brand or "Unbranded")
    name, size = _get(row, "item"), _get(row, "size")
    if not name:
        raise ImportProblem("each row needs product_id, item_id or an item name")
    if not size:
        m = SIZE_RE.search(name)
        if m:
            size = m.group(0)
            name = (name[:m.start()] + name[m.end():]).strip(" -,")
    if not brand:  # leaflets often say "Top Score Super Maize Meal": peel off a known brand
        for r in conn.execute("SELECT DISTINCT brand FROM products ORDER BY length(brand) DESC"):
            if name.lower().startswith(r["brand"].lower() + " "):
                brand, name = r["brand"], name[len(r["brand"]):].strip()
                break
    norm_size = re.sub(r"\s+", "", size.lower())
    found = None
    for r in conn.execute("SELECT id, size FROM items WHERE lower(name) = lower(?)", (name,)):
        if re.sub(r"\s+", "", r["size"].lower()) == norm_size:
            found = r["id"]
            break
    if found is None:
        from .deals import _scored_items  # fuzzy match to an existing catalogue item of the same size
        for it, score in _scored_items(conn, f"{name} {size}", 5):
            if re.sub(r"\s+", "", it["size"].lower()) == norm_size and score >= 3 * len(name.split()):
                found = it["id"]
                break
    if found is None:
        unit, qty = _size_info(size)
        found = upsert_item(conn, slug(name, size) or slug(name), name[:80], size=size[:30], unit=unit, qty=qty,
                            category=_get(row, "category") or "Other")
    return upsert_product(conn, found, brand or "Unbranded")


def apply_price(conn, store_id: str, pid: str, *, price: float | None, special_price: float | None,
                label: str | None, valid_from: str | None, valid_until: str | None, source: str,
                reported_by: int | None = None, branch: str | None = None):
    """Insert or update the current price of one product at one shop."""
    cur = conn.execute("SELECT price FROM prices WHERE store_id = ? AND product_id = ?", (store_id, pid)).fetchone()
    regular = price if price is not None else (cur["price"] if cur else None)
    if regular is None:
        if special_price is None:
            raise ImportProblem("no price given")
        regular = special_price
    if special_price is not None and special_price > regular:
        raise ImportProblem("the special price is higher than the normal price")
    conn.execute(
        "INSERT INTO prices(store_id, product_id, price, special_price, special_label, valid_from, valid_until, "
        "source, reported_by, branch, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(store_id, product_id) DO UPDATE SET price=excluded.price, "
        "special_price=excluded.special_price, special_label=excluded.special_label, "
        "valid_from=excluded.valid_from, valid_until=excluded.valid_until, source=excluded.source, "
        "reported_by=excluded.reported_by, branch=excluded.branch, updated_at=excluded.updated_at",
        (store_id, pid, regular, special_price, (label or None) and label[:60], valid_from, valid_until,
         source, reported_by, (branch or None) and branch[:60], stamp()))


def import_rows(conn, rows: list[dict], source: str, default_store: str | None = None,
                first_row: int = 1) -> dict:
    summary = {"imported": 0, "errors": []}
    for n, raw in enumerate(rows, start=first_row):
        row = {str(k).strip().lower().replace(" ", "_"): v for k, v in raw.items() if k is not None}
        try:
            store = _resolve_store(conn, _get(row, "store") or default_store or "")
            pid = _resolve_product(conn, row)
            price, special = _money(_get(row, "price")), _money(_get(row, "special_price"))
            if price is None and special is None:
                raise ImportProblem("no price given")
            apply_price(conn, store, pid, price=price, special_price=special,
                        label=_get(row, "special_label") or ("Special" if special else None),
                        valid_from=_date(_get(row, "valid_from")) if special else None,
                        valid_until=_date(_get(row, "valid_until")) if special else None,
                        source=source, branch=_get(row, "branch"))
            summary["imported"] += 1
        except ImportProblem as e:
            summary["errors"].append(f"row {n}: {e}")
    conn.commit()
    summary["errors"] = summary["errors"][:50]
    return summary


def parse_text(text: str, fmt: str | None = None) -> tuple[list[dict], str]:
    text = text.lstrip("\ufeff")
    fmt = fmt or ("json" if text.lstrip()[:1] in ("[", "{") else "csv")
    if fmt == "json":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("specials") or data.get("prices") or data.get("items") or []
        if not isinstance(data, list):
            raise ImportProblem("JSON must be a list of price objects")
        return [r for r in data if isinstance(r, dict)], fmt
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return list(csv.DictReader(io.StringIO(text), dialect=dialect)), "csv"


def import_text(conn, text: str, source: str = "import", fmt: str | None = None,
                default_store: str | None = None) -> dict:
    try:
        rows, fmt = parse_text(text, fmt)
    except (ValueError, csv.Error) as e:
        return {"imported": 0, "errors": [f"could not read the file: {e}"]}
    return import_rows(conn, rows, source, default_store, first_row=2 if fmt == "csv" else 1)


# ---------------------------------------------------------------- feeds

def feed_config() -> list[dict]:
    path = data_dir() / "sources.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return []
    return [f for f in data if isinstance(f, dict) and f.get("url")]


def refresh_feeds(conn, timeout: int = 30) -> list[dict]:
    """Fetch every configured feed and import it. Returns one status entry per feed."""
    results = []
    for f in feed_config():
        name = f.get("name") or f["url"]
        try:
            req = urllib.request.Request(f["url"], headers={"User-Agent": "SmartBasketNamibia/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read(5_000_000).decode("utf-8", errors="replace")
            res = import_text(conn, text, source=f"feed:{name}"[:60], fmt=f.get("format"),
                              default_store=f.get("store"))
            results.append({"name": name, "ok": True, **res})
        except Exception as e:  # network problems must never take the app down
            results.append({"name": name, "ok": False, "imported": 0, "errors": [str(e)]})
    set_setting(conn, "feeds_status", json.dumps({"at": stamp(), "results": results}))
    conn.commit()
    return results


def feeds_status(conn) -> dict:
    return json.loads(get_setting(conn, "feeds_status", "{}") or "{}")


# ---------------------------------------------------------------- community reports

def report_special(conn, user_id: int, store_id: str, special_price: float, *, product_id_: str | None = None,
                   item_id: str | None = None, brand: str | None = None, price: float | None = None,
                   label: str | None = None, valid_until: str | None = None, branch: str | None = None) -> str:
    """A shopper reports a special they saw. Returns the product id."""
    if not conn.execute("SELECT 1 FROM stores WHERE id = ?", (store_id,)).fetchone():
        raise ImportProblem("Pick a shop.")
    if product_id_:
        if not conn.execute("SELECT 1 FROM products WHERE id = ?", (product_id_,)).fetchone():
            raise ImportProblem("Unknown product.")
        pid = product_id_
    elif item_id and conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone():
        if not (brand or "").strip():
            raise ImportProblem("Enter the brand.")
        pid = conn.execute("SELECT id FROM products WHERE id = ?", (product_id(item_id, brand.strip()),)).fetchone()
        pid = pid["id"] if pid else upsert_product(conn, item_id, brand.strip()[:40])
    else:
        raise ImportProblem("Pick the product.")
    if not 0 < special_price < MAX_PRICE or (price is not None and not 0 < price < MAX_PRICE):
        raise ImportProblem("Enter a valid price.")
    cur = conn.execute("SELECT price FROM prices WHERE store_id = ? AND product_id = ?",
                       (store_id, pid)).fetchone()
    if price is None and not cur:
        raise ImportProblem("We don't have this product's normal price at this shop yet. Please add it too.")
    if special_price >= (price if price is not None else cur["price"]):
        raise ImportProblem("The special price should be lower than the normal price.")
    d = today()
    until = date.fromisoformat(valid_until) if valid_until else d + timedelta(days=6)
    if until < d:
        raise ImportProblem("That special has already ended.")
    if until > d + timedelta(days=62):
        raise ImportProblem("Specials can be reported up to two months ahead.")
    apply_price(conn, store_id, pid, price=price, special_price=round(special_price, 2),
                label=(label or "Community special").strip(), valid_from=d.isoformat(),
                valid_until=until.isoformat(), source="community", reported_by=user_id, branch=branch)
    conn.execute("INSERT INTO reports(user_id, store_id, product_id, price, special_price, special_label, "
                 "valid_until, branch, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                 (user_id, store_id, pid, price, special_price, label, until.isoformat(), branch, stamp()))
    conn.commit()
    return pid
