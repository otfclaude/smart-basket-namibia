"""Price and specials queries: current specials, product search, price comparison, list parsing."""
from __future__ import annotations

import re
from datetime import date

from .db import today

UNIT_LABEL = {"kg": "per kg", "L": "per litre", "each": "each"}

_PRICE_SQL = """
SELECT pr.id AS price_id, pr.store_id, pr.product_id, pr.price, pr.special_price, pr.special_label,
       pr.valid_from, pr.valid_until, pr.source, pr.branch, pr.updated_at,
       p.brand, p.item_id, i.name AS item_name, i.size, i.unit, i.qty, i.category,
       s.name AS store_name, u.name AS reporter
FROM prices pr
JOIN products p ON p.id = pr.product_id
JOIN items i ON i.id = p.item_id
JOIN stores s ON s.id = pr.store_id
LEFT JOIN users u ON u.id = pr.reported_by
"""


def special_active(r, d: date) -> bool:
    if r["special_price"] is None or r["special_price"] >= r["price"]:
        return False
    if r["valid_from"] and r["valid_from"] > d.isoformat():
        return False
    return not (r["valid_until"] and r["valid_until"] < d.isoformat())


def price_view(r, d: date | None = None) -> dict:
    """One shop's price for one product, with the special applied if it is running today."""
    d = d or today()
    on = special_active(r, d)
    now = r["special_price"] if on else r["price"]
    per = r["qty"] or 1
    out = {
        "price_id": r["price_id"], "store_id": r["store_id"], "store_name": r["store_name"],
        "product_id": r["product_id"], "item_id": r["item_id"], "brand": r["brand"],
        "name": r["item_name"], "size": r["size"], "category": r["category"],
        "price": round(now, 2), "regular_price": round(r["price"], 2), "on_special": on,
        "special_label": r["special_label"] if on else None,
        "valid_until": r["valid_until"] if on else None,
        "saving": round(r["price"] - now, 2) if on else 0.0,
        "saving_pct": round(100 * (r["price"] - now) / r["price"]) if on and r["price"] else 0,
        "unit_price": round(now / per, 2) if per else None,
        "unit_label": UNIT_LABEL.get(r["unit"], "each"),
        "source": r["source"], "branch": r["branch"], "updated_at": r["updated_at"],
        "reporter": (r["reporter"] or "").split(" ")[0] or None,  # first name only
    }
    return out


def specials(conn, q: str = "", stores: list[str] | None = None, category: str = "",
             sort: str = "percent", limit: int = 60, offset: int = 0) -> dict:
    d = today()
    rows = conn.execute(_PRICE_SQL + " WHERE pr.special_price IS NOT NULL AND pr.special_price < pr.price").fetchall()
    out = [price_view(r, d) for r in rows if special_active(r, d)]
    if stores:
        keep = set(stores)
        out = [x for x in out if x["store_id"] in keep]
    if category:
        out = [x for x in out if x["category"] == category]
    if q.strip():
        scores = {it["id"]: sc for it, sc in _scored_items(conn, q)}
        out = [x for x in out if x["item_id"] in scores]
        out.sort(key=lambda x: -scores[x["item_id"]])
    keys = {
        "percent": lambda x: (-x["saving_pct"], -x["saving"]),
        "saving": lambda x: (-x["saving"], -x["saving_pct"]),
        "price": lambda x: (x["price"], -x["saving_pct"]),
        "ending": lambda x: (x["valid_until"] or "9999", -x["saving_pct"]),
        "name": lambda x: (x["name"], x["price"]),
    }
    if not q.strip() or sort != "relevance":
        out.sort(key=keys.get(sort, keys["percent"]))
    total = len(out)
    return {"total": total, "results": out[offset: offset + limit], "today": d.isoformat()}


# ---------------------------------------------------------------- search

_UNIT_FIX = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litre|liter|litres|liters)\b", re.I)


def _norm(text: str) -> str:
    t = _UNIT_FIX.sub(lambda m: m.group(1).replace(",", ".") + {"litre": "l", "liter": "l", "litres": "l",
                                                                 "liters": "l"}.get(m.group(2).lower(),
                                                                                    m.group(2).lower()),
                      text.lower())
    return re.sub(r"[^a-z0-9.&' ]+", " ", t)


def _tokens(text: str) -> list[str]:
    stop = {"a", "an", "the", "of", "and", "for", "pack", "x"}
    return [t for t in _norm(text).split() if t and t not in stop]


def _item_index(conn):
    brands: dict[str, list[str]] = {}
    for r in conn.execute("SELECT item_id, brand FROM products"):
        brands.setdefault(r["item_id"], []).append(r["brand"])
    items = []
    for r in conn.execute("SELECT rowid AS sort, * FROM items"):
        items.append({"id": r["id"], "name": r["name"], "size": r["size"], "unit": r["unit"],
                      "qty": r["qty"], "category": r["category"], "keywords": r["keywords"],
                      "brands": brands.get(r["id"], []), "sort": r["sort"]})
    return items


def _score(tokens: list[str], it: dict) -> float:
    name = _tokens(it["name"])
    size_words = _norm(it["size"]).split()
    size = "".join(size_words)
    kw = _norm(it["keywords"])
    brands = _norm(" ".join(it["brands"]))
    cat = _norm(it["category"])
    score, matched = 0.0, 0
    for t in tokens:
        stem = t[:-1] if t.endswith("s") and len(t) > 3 else t
        word = rf"\b{re.escape(stem)}s?\b"
        s = 0.0
        if t in name:
            s = 4
        elif any(w.rstrip("s") == t.rstrip("s") for w in name):
            s = 3.5
        elif re.search(word, kw):
            s = 3.5
        elif len(t) >= 3 and any(w.startswith(t) for w in name):
            s = 2.5
        if s >= 3.5 and re.search(word, kw):
            s += 0.5                      # the catalogue says this is what people mean by the word
        if t == size or (t[0].isdigit() and size.startswith(t)):
            s = max(s, 3)
        elif not t[0].isdigit() and re.search(word, " ".join(size_words)):
            s = max(s, 2)
        if re.search(word, brands):
            s = max(s, 3)
        elif len(t) >= 3 and re.search(rf"\b{re.escape(t)}", kw + " " + brands):
            s = max(s, 2)
        if re.search(word, cat):
            s = max(s, 1)
        if s:
            matched += 1
        score += s
    if not tokens or matched < max(1, len(tokens) - (1 if len(tokens) > 2 else 0)):
        return 0.0
    return score + matched / len(tokens)


def _scored_items(conn, q: str, limit: int = 50):
    tokens = _tokens(q)
    scored = [(it, _score(tokens, it)) for it in _item_index(conn)]
    scored = [x for x in scored if x[1] > 0]
    scored.sort(key=lambda x: (-x[1], x[0]["sort"], x[0]["name"]))
    if scored:  # drop weak matches (e.g. only the category name) when there are strong ones
        top = scored[0][1]
        scored = [x for x in scored if x[1] >= top * 0.5]
    return scored[:limit]


def item_prices(conn, item_id: str, stores: list[str] | None = None) -> list[dict]:
    d = today()
    rows = conn.execute(_PRICE_SQL + " WHERE p.item_id = ?", (item_id,)).fetchall()
    out = [price_view(r, d) for r in rows]
    if stores:
        out = [x for x in out if x["store_id"] in set(stores)]
    out.sort(key=lambda x: (x["price"], x["store_name"]))
    return out


def search(conn, q: str, stores: list[str] | None = None, limit: int = 20) -> list[dict]:
    out = []
    for it, sc in _scored_items(conn, q, limit):
        prices = item_prices(conn, it["id"], stores)
        best = prices[0] if prices else None
        out.append({**{k: it[k] for k in ("id", "name", "size", "unit", "category", "brands")},
                    "score": round(sc, 2), "best": best, "n_shops": len({p["store_id"] for p in prices}),
                    "n_specials": sum(p["on_special"] for p in prices)})
    return out


def item_detail(conn, item_id: str, stores: list[str] | None = None) -> dict | None:
    it = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if it is None:
        return None
    products = [{"id": r["id"], "brand": r["brand"]}
                for r in conn.execute("SELECT id, brand FROM products WHERE item_id = ? ORDER BY brand", (item_id,))]
    return {"id": it["id"], "name": it["name"], "size": it["size"], "unit": it["unit"],
            "category": it["category"], "products": products, "prices": item_prices(conn, item_id, stores)}


# ---------------------------------------------------------------- shopping-list text

_QTY_PATTERNS = [
    re.compile(r"^(?P<q>\d{1,3})\s*(?:x|×|\*)\s*(?P<t>.+)$", re.I),           # 2 x bread / 2x bread
    re.compile(r"^(?P<t>.+?)\s*(?:x|×|\*)\s*(?P<q>\d{1,3})$", re.I),           # bread x2
    re.compile(r"^(?P<q>\d{1,3})\s+(?!(?:kg|g|l|ml|litres?|liters?)\b)(?P<t>[a-z].+)$", re.I),  # 2 bread
]


def parse_list(conn, text: str) -> list[dict]:
    """Turn free text such as '2 x bread, maize meal 10kg, cooking oil' into catalogue matches."""
    out = []
    for raw in re.split(r"[\n,;]+", text or ""):
        line = raw.strip(" -•*\t")
        if not line:
            continue
        qty, query, plain = 1, line, False
        for i, pat in enumerate(_QTY_PATTERNS):
            m = pat.match(line)
            if m:
                qty, query, plain = max(1, min(99, int(m.group("q")))), m.group("t").strip(), i == 2
                break
        matches = _scored_items(conn, query, 4)
        if plain and matches:  # "18 eggs" usually means an 18-pack, not eighteen packs
            whole = _scored_items(conn, line, 4)
            top = whole[0][0] if whole else None
            if (top and top["unit"] == "each" and int(top["qty"]) == qty
                    and top["id"] in {it["id"] for it, _ in matches}):
                qty, matches = 1, whole
        out.append({"text": line, "qty": qty,
                    "item": _brief(matches[0][0]) if matches else None,
                    "alternatives": [_brief(it) for it, _ in matches[1:4]]})
    return out


def _brief(it: dict) -> dict:
    return {"id": it["id"], "name": it["name"], "size": it["size"], "category": it["category"]}


# ---------------------------------------------------------------- optimiser input

def cart_options(conn, lines: list[dict], stores: list[str] | None = None) -> dict:
    """For each cart line, every (shop, product) that can satisfy it with today's price."""
    d = today()
    allowed = set(stores) if stores else None
    info, options = {}, {}
    for ln in lines:
        key = ln["key"]
        if ln.get("product_id"):
            rows = conn.execute(_PRICE_SQL + " WHERE pr.product_id = ?", (ln["product_id"],)).fetchall()
            prod = conn.execute("SELECT p.brand, i.* FROM products p JOIN items i ON i.id = p.item_id "
                                "WHERE p.id = ?", (ln["product_id"],)).fetchone()
        else:
            rows = conn.execute(_PRICE_SQL + " WHERE p.item_id = ?", (ln.get("item_id"),)).fetchall()
            prod = conn.execute("SELECT NULL AS brand, i.* FROM items i WHERE i.id = ?",
                                (ln.get("item_id"),)).fetchone()
        info[key] = ({"item_id": prod["id"], "name": prod["name"], "size": prod["size"],
                      "category": prod["category"], "brand": prod["brand"]} if prod else
                     {"item_id": ln.get("item_id"), "name": ln.get("name") or "Unknown item", "size": "",
                      "category": "", "brand": None})
        opts = [price_view(r, d) for r in rows]
        options[key] = [o for o in opts if allowed is None or o["store_id"] in allowed]
    return {"info": info, "options": options}
