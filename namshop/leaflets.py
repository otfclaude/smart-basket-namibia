"""Fetch shops' specials pamphlets from the web and read their prices with Claude.

The **Refresh** button runs :class:`RefreshManager`, which for every shop in
``data/leaflet_sources.json`` (or ``<data dir>/leaflet_sources.json``):

1. opens the shop's specials pages (and specials.na-style aggregator pages), politely and only
   where robots.txt allows;
2. finds the pamphlets on them: PDF files, or the page images of an image leaflet;
3. downloads each one. A pamphlet with the same content as one already read is skipped;
4. sends new pamphlets to Claude, which returns every product and price as structured JSON;
5. imports those prices as specials (source ``leaflet:<shop>``), and keeps the pamphlet so
   shoppers can flip through it on the Pamphlets page.

Without Claude credentials, steps 1–3 and 5's "flip through it" still work and the app says
that prices will be read automatically once a key is added.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from urllib.parse import unquote, urljoin

from . import BUNDLED_DATA, data_dir, db, importer, net

MODEL = os.environ.get("NAMSHOP_CLAUDE_MODEL", "claude-opus-5-5")
# Bumped when finding pamphlets changes enough that pamphlets should be fetched again right away
FETCHER_VERSION = "2"   # 2: specials.na pamphlets as whole PDFs instead of their covers
MIN_GAP = int(os.environ.get("NAMSHOP_REFRESH_MIN_GAP", "900"))  # seconds between public refreshes
MAX_PAMPHLETS = 3          # per shop per refresh
MAX_PAGES = 24             # images per image-pamphlet
MAX_IMAGES_PER_CALL = 20
MAX_IMAGE_BYTES = 5_000_000
MIN_IMAGE_BYTES = 25_000   # smaller images are logos/icons, not leaflet pages
LEAFLET_WORDS = re.compile(r"leaflet|pamphlet|catalog|brochure|flyer|special|promo|deal|saving|offer|"
                           r"mailer|insert|week|month|page|spread", re.I)
NOT_LEAFLET = re.compile(r"logo|icon|favicon|sprite|avatar|social|facebook|twitter|instagram|whatsapp|"
                         r"youtube|app-?store|google-?play|payment|visa|mastercard|loader|spinner|arrow", re.I)
# PDFs a shop links to that aren't pamphlets (e.g. Model's "Birthday Ts & Cs")
NOT_PAMPHLET = re.compile(r"terms|conditions|(?<![a-z])ts?\s*(?:&|and)\s*cs?(?![a-z])|privacy|policy|competition[\s_-]*rules|"
                          r"entry[\s_-]*form|vacanc|careers?", re.I)
# A pamphlet's cover or thumbnail on a listing page: the pamphlet itself is on its own page (see "files")
COVER = re.compile(r"[?&]path=covers?(?:%2F|/)|/covers?/|thumb", re.I)

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "valid_from", "valid_until", "products"],
    "properties": {
        "title": {"type": "string", "description": "Pamphlet headline, e.g. 'Month-end specials'"},
        "valid_from": {"type": "string", "description": "YYYY-MM-DD, or empty if not shown"},
        "valid_until": {"type": "string", "description": "YYYY-MM-DD, or empty if not shown"},
        "products": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["item", "brand", "size", "category", "price", "special_price", "label",
                             "valid_until"],
                "properties": {
                    "item": {"type": "string", "description": "Generic product name without brand or size, "
                                                              "e.g. 'Super maize meal'"},
                    "brand": {"type": "string", "description": "Brand, or empty for fresh/unbranded"},
                    "size": {"type": "string", "description": "Pack size, e.g. '10kg', '750ml', '6 pack'"},
                    "category": {"type": "string"},
                    "price": {"type": "number", "description": "Normal/was price in N$, or 0 if not shown"},
                    "special_price": {"type": "number", "description": "Promotional price for ONE unit in N$"},
                    "label": {"type": "string", "description": "Deal wording, e.g. 'Buy 2 for N$50', or empty"},
                    "valid_until": {"type": "string", "description": "YYYY-MM-DD if this item has its own end "
                                                                     "date, else empty"},
                },
            },
        },
    },
}

PROMPT = """This is a specials pamphlet from {shop}, a shop in Namibia. Prices are in Namibian dollars (N$).
Today is {today}.

List every product that has a price in the pamphlet. For each one:
- item: the generic product name without brand or size ("Super maize meal", "Sunflower cooking oil")
- brand: as printed, or "" for fresh or unbranded produce
- size: pack size as printed ("10kg", "2L", "750ml", "18 pack", "per kg")
- category: one of {categories}
- special_price: the promotional price for one unit. For multi-buys ("2 for N$50") give the per-unit
  price (25.00) and put the wording in label
- price: the normal / "was" price if the pamphlet shows one, otherwise 0
- label: deal wording if any ("Buy 2 for N$50", "Xtra Savings", "Smart Price"), otherwise ""
- valid_until: only if this product has its own end date, otherwise ""

Also give the pamphlet's title and its valid_from / valid_until dates (YYYY-MM-DD; infer the year
from today's date when only day and month are printed; "" if not shown).
Skip items without a readable price. Do not invent products or prices."""


# ---------------------------------------------------------------- config

def sources() -> dict[str, list[dict]]:
    override = data_dir() / "leaflet_sources.json"
    path = override if override.exists() else BUNDLED_DATA / "leaflet_sources.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_") and isinstance(v, list)}


def _key_file():
    return data_dir() / "anthropic_api_key"


def claude_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or (_key_file().exists() and _key_file().read_text().strip()))


def save_api_key(key: str):
    path = _key_file()
    path.write_text(key.strip())
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _client():
    import anthropic
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key and not os.environ.get("ANTHROPIC_AUTH_TOKEN") and _key_file().exists():
        key = _key_file().read_text().strip()
    return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()


# ---------------------------------------------------------------- discovery

@dataclass
class Pamphlet:
    store_id: str
    title: str
    page_url: str
    urls: list[str]                      # one PDF, or the page images in order
    kind: str = "pdf"                    # pdf | images | flipbook | auto (a PDF or an image, known on download)
    files: list[tuple[bytes, str]] = field(default_factory=list)  # (body, kind) after download
    valid_from: str | None = None        # when the page says (used until Claude reads the pamphlet)
    valid_until: str | None = None


def _is_pdf(url: str) -> bool:
    return bool(re.search(r"\.pdf(?:$|[?#])", url, re.I))


def _is_image(url: str) -> bool:
    return bool(re.search(r"\.(?:jpe?g|png|webp)(?:$|[?#])", url, re.I))


def _clean_title(title: str) -> str:
    """'Shoprite — Mid Month (valid until 18 Oct) | Specials.NA | Specials.NA' -> without the site name."""
    return title.split(" | ")[0].strip()


def _page_dates(text: str) -> tuple[str | None, str | None]:
    """A pamphlet page's own dates, from its data: ..."start_date":"2026-10-05","end_date":"2026-10-18","file_url"..."""
    m = re.search(r'start_date\W+(\d{4}-\d\d-\d\d)\W+end_date\W+(\d{4}-\d\d-\d\d)\W+file_url', text)
    return (m.group(1), m.group(2)) if m else (None, None)


def find_pamphlets(store_id: str, source: dict, fetch_text=net.fetch_text) -> list[Pamphlet]:
    """Pamphlets linked from one source page (following detail links when configured).

    ``files`` in a source is a regex for pamphlet file links in a page's text that don't look like files,
    e.g. specials.na's ``/api/special/<id>/download``, which returns the whole pamphlet as a PDF.
    """
    url = source["url"]
    if source.get("type") == "pdf":
        return [Pamphlet(store_id, source.get("title", "Pamphlet"), url, [url], "pdf")]
    html, final = fetch_text(url)
    links, title = net.page_links(html, final)
    pages = [(final, title, links, html)]
    if source.get("follow"):
        follow = re.compile(source["follow"], re.I)
        detail = [ln["url"] for ln in links if follow.search(ln["url"]) and ln["url"] != final]
        for u in list(dict.fromkeys(detail))[: source.get("max", MAX_PAMPHLETS)]:
            try:
                h2, f2 = fetch_text(u)
            except net.FetchError:
                continue
            l2, t2 = net.page_links(h2, f2)
            pages.append((f2, t2, l2, h2))
    include = re.compile(source["match"], re.I) if source.get("match") else None
    files = re.compile(source["files"], re.I) if source.get("files") else None
    out: list[Pamphlet] = []
    seen: set[str] = set()
    if source.get("flipbooks"):
        fb = re.compile(source["flipbooks"], re.I)
        for page_url, page_title, page_links, _ in pages:
            for ln in page_links:
                root = _flipbook_root(ln["url"])
                if fb.search(ln["url"]) and root not in seen:
                    seen.add(root)
                    out.append(Pamphlet(store_id, ln["text"] or page_title or "Pamphlet", page_url, [root], "flipbook"))
    # a pamphlet's own page first: it has the pamphlet's real title and dates
    for page_url, page_title, page_links, page_html in pages[1:] + pages[:1]:
        name = _clean_title(page_title) or "Pamphlet"
        has_file = False
        if files:
            text = page_html.replace("\\/", "/").replace("\\u0026", "&")
            vf, vu = _page_dates(text)
            found = [urljoin(page_url, m.group(0)) for m in files.finditer(text)]
            own = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", page_url, re.I)
            if own and any(own.group(0).lower() in u.lower() for u in found):  # not "related pamphlets"
                found = [u for u in found if own.group(0).lower() in u.lower()]
            for u in found:
                if u not in seen:
                    seen.add(u)
                    has_file = True
                    out.append(Pamphlet(store_id, name, page_url, [u], "auto", valid_from=vf, valid_until=vu))
        images = []
        for ln in page_links:
            u, ctx = ln["url"], f'{ln["url"]} {ln["text"]}'
            if u in seen or NOT_LEAFLET.search(ctx) or ln.get("rel") in ("icon", "apple-touch-icon"):
                continue
            if include is not None and not include.search(ctx):
                continue
            if _is_pdf(u):
                # skip the same pamphlet's other copies when the page gave its download link
                if NOT_PAMPHLET.search(unquote(ctx)) or (files and has_file):
                    continue
                seen.add(u)
                has_file = True
                out.append(Pamphlet(store_id, _clean_title(ln["text"]) or name, page_url, [u], "pdf"))
            elif _is_image(u) and not COVER.search(u) and ln["tag"] in ("img", "a", "text", "meta") and (
                    include is not None or LEAFLET_WORDS.search(ctx)):
                seen.add(u)
                images.append(u)
        if images and not has_file:  # a page with the pamphlet as a file: its images are covers and banners
            out.append(Pamphlet(store_id, name, page_url, images[:MAX_PAGES], "images"))
    return out[: source.get("max", MAX_PAMPHLETS)]


def _flipbook_root(url: str) -> str:
    """https://x/deals/slug/12/index.html -> https://x/deals/slug/"""
    u = re.sub(r"[?#].*$", "", url)
    u = re.sub(r"(/index\.html?)$", "/", u)
    u = re.sub(r"/\d{1,3}/?$", "/", u)
    return u if u.endswith("/") else u + "/"


FLIPBOOK_PDF = "files/assets/common/downloads/publication.pdf"
FLIPBOOK_PAGE_IMAGES = ("files/assets/common/page-html5-substrates/page{n:04d}_4.jpg",
                        "files/assets/common/page-substrates/page{n:04d}_4.jpg",
                        "files/assets/flash/pages/page{n:04d}_l.jpg")


def resolve_flipbook(root: str, fetch=net.fetch, fetch_text=net.fetch_text) -> list[tuple[bytes, str]]:
    """A flipbook's pages: its PDF download if it has one, else one image per page."""
    def get(url):
        try:
            body, _, _ = fetch(url)
        except net.FetchError:
            return None, None
        return body, net.file_kind(body)
    body, kind = get(root + FLIPBOOK_PDF)
    if kind == "pdf":
        return [(body, "pdf")]
    try:
        html, final = fetch_text(root)
        links, _ = net.page_links(html, final)
    except net.FetchError:
        links = []
    for ln in links:  # a "download PDF" button
        if _is_pdf(ln["url"]):
            body, kind = get(ln["url"])
            if kind == "pdf":
                return [(body, "pdf")]
    pages: list[tuple[bytes, str]] = []
    pattern = None
    for n in range(1, MAX_PAGES + 1):
        cands = [pattern.format(n=n)] if pattern else []
        if not cands:
            try:  # each flipbook page has its own HTML page whose preview image is the page
                html, final = fetch_text(f"{root}{n}/")
                plinks, _ = net.page_links(html, final)
                cands = [ln["url"] for ln in plinks if ln.get("rel") == "og:image"]
                cands += [ln["url"] for ln in plinks if _is_image(ln["url"]) and re.search(r"page", ln["url"], re.I)]
            except net.FetchError:
                cands = []
            cands += [root + pat.format(n=n) for pat in FLIPBOOK_PAGE_IMAGES]
        got = None
        for c in cands:
            body, kind = get(c)
            if kind in ("jpeg", "png", "webp") and len(body) >= MIN_IMAGE_BYTES:
                got = (body, kind)
                for pat in FLIPBOOK_PAGE_IMAGES:  # remember a direct pattern to skip the HTML next time
                    if c == root + pat.format(n=n):
                        pattern = root + pat
                break
        if got is None:
            break
        pages.append(got)
    return pages


def download(p: Pamphlet, fetch=net.fetch, fetch_text=net.fetch_text) -> Pamphlet:
    if p.kind == "auto":  # a download link: whatever it returns, a PDF or a page image
        for u in p.urls:
            try:
                body, _, _ = fetch(u)
            except net.FetchError:
                continue
            kind = net.file_kind(body)
            if kind == "pdf":
                p.kind, p.files = "pdf", [(body, kind)]
                return p
            if kind in ("png", "jpeg", "webp", "gif") and len(body) >= MIN_IMAGE_BYTES:
                p.files.append((body, kind))
        p.kind = "images" if p.files else "pdf"
        return p
    if p.kind == "flipbook":
        p.files = resolve_flipbook(p.urls[0], fetch, fetch_text)
        p.kind = "pdf" if p.files and p.files[0][1] == "pdf" else "images"
        return p
    for u in p.urls:
        try:
            body, _, _ = fetch(u)
        except net.FetchError:
            continue
        kind = net.file_kind(body)
        if p.kind == "pdf" and kind == "pdf":
            p.files.append((body, kind))
        elif p.kind == "images" and kind in ("png", "jpeg", "webp", "gif") and len(body) >= MIN_IMAGE_BYTES:
            p.files.append((body, kind))
    return p


def fingerprint(p: Pamphlet) -> str:
    h = hashlib.sha256()
    for body, _ in p.files:
        h.update(hashlib.sha256(body).digest())
    return h.hexdigest()


# ---------------------------------------------------------------- reading with Claude

def _blocks(files: list[tuple[bytes, str]]) -> list[dict]:
    out = []
    for body, kind in files:
        data = base64.standard_b64encode(body).decode()
        if kind == "pdf":
            out.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                                        "data": data}})
        elif len(body) <= MAX_IMAGE_BYTES:
            out.append({"type": "image", "source": {"type": "base64", "media_type": net.MIME[kind], "data": data}})
    return out


def read_with_claude(shop: str, files: list[tuple[bytes, str]], categories: list[str], client=None) -> dict:
    """Send a pamphlet to Claude; returns {"title", "valid_from", "valid_until", "products": [...]}."""
    import anthropic
    client = client or _client()
    merged = {"title": "", "valid_from": "", "valid_until": "", "products": []}
    pdfs = [f for f in files if f[1] == "pdf"]
    images = [f for f in files if f[1] != "pdf"]
    batches = [[f] for f in pdfs] + [images[i:i + MAX_IMAGES_PER_CALL]
                                     for i in range(0, len(images), MAX_IMAGES_PER_CALL)]
    for batch in batches:
        content = _blocks(batch)
        if not content:
            continue
        content.append({"type": "text", "text": PROMPT.format(shop=shop, today=date.today().isoformat(),
                                                              categories=", ".join(categories))})
        try:
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=64000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",                      # retry on another model if this one declines
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content": content}],
            ) as stream:
                msg = stream.get_final_message()
        except anthropic.AuthenticationError as e:
            raise ReadError("The Claude API key was rejected. Check it on the Admin page.") from e
        except anthropic.RateLimitError as e:
            raise ReadError("Claude is busy (rate limited). Try again in a few minutes.") from e
        except anthropic.APIStatusError as e:
            raise ReadError(f"Claude couldn't read this pamphlet ({e.status_code}).") from e
        except anthropic.APIConnectionError as e:
            raise ReadError("Couldn't reach Claude. Check the internet connection.") from e
        if msg.stop_reason == "refusal":
            raise ReadError("Claude declined to read this pamphlet.")
        text = next((b.text for b in msg.content if b.type == "text"), "")
        try:
            data = json.loads(text)
        except ValueError as e:
            raise ReadError("Claude's answer was cut off (pamphlet too long).") from e
        for k in ("title", "valid_from", "valid_until"):
            merged[k] = merged[k] or data.get(k, "")
        merged["products"].extend(data.get("products", []))
    return merged


class ReadError(RuntimeError):
    pass


def _iso(s: str) -> str | None:
    try:
        return date.fromisoformat((s or "").strip()[:10]).isoformat()
    except ValueError:
        return None


def to_rows(store_id: str, data: dict) -> list[dict]:
    """Claude's products → importer rows."""
    rows = []
    lf, lu = _iso(data.get("valid_from")), _iso(data.get("valid_until"))
    for p in data.get("products", []):
        special = float(p.get("special_price") or 0)
        price = float(p.get("price") or 0)
        if special <= 0 and price <= 0:
            continue
        if special <= 0:
            special, price = price, 0
        if not (p.get("item") or "").strip():
            continue
        rows.append({
            "store": store_id, "item": p["item"].strip(), "size": (p.get("size") or "").strip(),
            "brand": (p.get("brand") or "").strip() or "Unbranded", "category": p.get("category") or "Other",
            "price": f"{price:.2f}" if price > special else "", "special_price": f"{special:.2f}",
            "special_label": (p.get("label") or "").strip() or (data.get("title") or "Pamphlet special")[:60],
            "valid_from": lf or "", "valid_until": _iso(p.get("valid_until")) or lu or "",
        })
    return rows


# ---------------------------------------------------------------- storage

def _store_files(p: Pamphlet, sha: str) -> list[str]:
    folder = data_dir() / "leaflets" / p.store_id
    folder.mkdir(parents=True, exist_ok=True)
    names = []
    for i, (body, kind) in enumerate(p.files):
        name = f"{sha[:16]}-{i + 1}{net.EXT[kind]}"
        path = folder / name
        if not path.exists():
            path.write_bytes(body)
        names.append(name)
    return names


def leaflet_path(store_id: str, name: str):
    p = (data_dir() / "leaflets" / store_id / name).resolve()
    root = (data_dir() / "leaflets").resolve()
    return p if root in p.parents and p.is_file() else None


def list_leaflets(conn, limit: int = 60) -> list[dict]:
    # Older versions saved specials.na listing covers as one-page "pamphlets": those stay hidden
    rows = conn.execute("SELECT l.*, s.name AS store_name FROM leaflets l JOIN stores s ON s.id = l.store_id "
                        "WHERE NOT (l.kind = 'images' AND (l.source_url LIKE '%path=covers%' OR l.source_url LIKE '%/covers/%')) "
                        "ORDER BY l.fetched_at DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        files = json.loads(r["files"])
        out.append({"id": r["id"], "store_id": r["store_id"], "store_name": r["store_name"], "title": r["title"],
                    "page_url": r["page_url"], "kind": r["kind"], "pages": len(files),
                    "files": [f"/leaflets/{r['store_id']}/{f}" for f in files],
                    "fetched_at": r["fetched_at"], "valid_from": r["valid_from"], "valid_until": r["valid_until"],
                    "status": r["status"], "message": r["message"], "n_specials": r["n_specials"]})
    return out


# ---------------------------------------------------------------- one shop

def refresh_store(conn, store_id: str, shop_name: str, srcs: list[dict], categories: list[str],
                  report, fetch=net.fetch, fetch_text=net.fetch_text, reader=None) -> dict:
    """Fetch and read one shop's pamphlets. ``report(state, message)`` updates the progress display."""
    found: list[Pamphlet] = []
    errors = []
    report("searching", "Looking for this week's pamphlets…")
    for src in srcs:
        if not net.allowed(src["url"], fetch_text):
            errors.append(f"{src['url']} asks apps not to fetch it")
            continue
        try:
            found.extend(find_pamphlets(store_id, src, fetch_text))
        except net.FetchError as e:
            errors.append(str(e))
        if len(found) >= MAX_PAMPHLETS:
            break
    if not found:
        msg = "No pamphlet found online right now." if not errors else "Couldn't reach the shop's website."
        return {"state": "none" if not errors else "error", "message": msg, "found": 0, "new": 0, "specials": 0,
                "errors": errors[:3]}
    report("downloading", f"Downloading {len(found)} pamphlet{'s' if len(found) > 1 else ''}…")
    new, specials = 0, 0
    messages = []
    done: set[str] = set()
    for p in found[:MAX_PAMPHLETS]:
        download(p, fetch, fetch_text)
        if not p.files:
            continue
        sha = fingerprint(p)
        if sha in done:  # the same pamphlet linked twice (e.g. its PDF and its download link)
            continue
        done.add(sha)
        known = conn.execute("SELECT id, status FROM leaflets WHERE store_id = ? AND sha256 = ?",
                             (store_id, sha)).fetchone()
        if known and known["status"] in ("read", "stored"):
            if known["status"] == "read" or not (reader or claude_configured()):
                continue
        names = _store_files(p, sha)
        status, message, n, vf, vu, title = "stored", "", 0, p.valid_from, p.valid_until, p.title
        if reader or claude_configured():
            report("reading", f"Reading prices with Claude ({len(p.files)} file{'s' if len(p.files) > 1 else ''})…")
            try:
                data = (reader or read_with_claude)(shop_name, p.files, categories)
                rows = to_rows(store_id, data)
                res = importer.import_rows(conn, rows, source=f"leaflet:{store_id}", default_store=store_id)
                n = res["imported"]
                status, message = "read", f"{n} prices read"
                vf, vu = _iso(data.get("valid_from")) or vf, _iso(data.get("valid_until")) or vu
                title = (data.get("title") or title)[:120]
            except ReadError as e:
                status, message = "error", str(e)
        else:
            message = "Saved. Prices will be read automatically once Claude is connected."
        conn.execute(
            "INSERT INTO leaflets(store_id, title, source_url, page_url, kind, files, sha256, fetched_at, valid_from, "
            "valid_until, status, message, n_specials) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(store_id, sha256) DO UPDATE SET status=excluded.status, message=excluded.message, "
            "n_specials=excluded.n_specials, valid_from=excluded.valid_from, valid_until=excluded.valid_until, "
            "title=excluded.title, fetched_at=excluded.fetched_at",
            (store_id, title[:120], p.urls[0], p.page_url, p.kind, json.dumps(names), sha, db.stamp(), vf, vu,
             status, message, n))
        conn.commit()
        new += 1
        specials += n
        messages.append(message)
    if not new:
        return {"state": "done", "message": "Already up to date.", "found": len(found), "new": 0, "specials": 0,
                "errors": errors[:3]}
    failed = all(m and "Claude" in m and "read" not in m for m in messages)
    return {"state": "error" if failed else "done",
            "message": (f"{specials} new prices from {new} pamphlet{'s' if new > 1 else ''}" if specials
                        else messages[-1]),
            "found": len(found), "new": new, "specials": specials, "errors": errors[:3]}


# ---------------------------------------------------------------- the Refresh button

class RefreshManager:
    """Runs one refresh at a time in the background and reports progress per shop."""

    def __init__(self, db_file: str, workers: int = 4):
        self.db_file = db_file
        self.workers = workers
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.state: dict = {"running": False, "started_at": None, "finished_at": None, "shops": {}, "summary": ""}
        self.last_finished = 0.0
        # injectable for tests
        self.fetch, self.fetch_text, self.reader, self.logo_fetch = net.fetch, net.fetch_text, None, None

    def status(self) -> dict:
        with self.lock:
            s = json.loads(json.dumps(self.state))
        s["claude"] = claude_configured() or self.reader is not None
        s["next_allowed_in"] = max(0, int(self.last_finished + MIN_GAP - time.time())) if not s["running"] else 0
        return s

    def start(self, force: bool = False) -> dict:
        with self.lock:
            running = self.thread is not None and self.thread.is_alive()
            fresh = time.time() - self.last_finished < MIN_GAP
            if not running and (force or not fresh):
                conn = db.connect(self.db_file)
                try:
                    names = {s["id"]: s["name"] for s in db.stores(conn)}
                finally:
                    conn.close()
                srcs = sources()
                self.state = {"running": True, "started_at": db.stamp(), "finished_at": None, "summary": "",
                              "shops": {sid: {"name": names.get(sid, sid), "state": "queued", "message": "Waiting…",
                                              "specials": 0} for sid in srcs if sid in names}}
                self.thread = threading.Thread(target=self._run, args=(srcs, names), daemon=True)
                self.thread.start()
        return self.status()

    def _update(self, sid: str, **kw):
        with self.lock:
            self.state["shops"].setdefault(sid, {}).update(kw)

    def _one(self, sid: str, srcs: list[dict], name: str, categories: list[str]):
        conn = db.connect(self.db_file)
        try:
            res = refresh_store(conn, sid, name, srcs, categories,
                                lambda st, msg: self._update(sid, state=st, message=msg),
                                self.fetch, self.fetch_text, self.reader)
            self._update(sid, state=res["state"], message=res["message"], specials=res["specials"])
        except Exception as e:  # one shop failing must not stop the rest
            self._update(sid, state="error", message=f"Something went wrong: {e}"[:200])
        finally:
            conn.close()

    def _run(self, srcs: dict, names: dict):
        conn = db.connect(self.db_file)
        try:
            categories = db.categories(conn)
        finally:
            conn.close()
        try:
            with ThreadPoolExecutor(max_workers=self.workers) as pool:
                for sid, s in srcs.items():
                    if sid in names:
                        pool.submit(self._one, sid, s, names[sid], categories)
            conn = db.connect(self.db_file)
            try:
                from . import logos
                logos.fetch_logos(conn, fetch=self.logo_fetch or self.fetch, fetch_text=self.fetch_text)
                importer.refresh_feeds(conn)
            except Exception:
                pass
            finally:
                conn.close()
        finally:
            with self.lock:
                shops = list(self.state["shops"].values())
                total = sum(s.get("specials", 0) for s in shops)
                ok = sum(s.get("state") == "done" for s in shops)
                if shops and all(s.get("state") == "error" for s in shops):
                    summary = "Couldn't reach the shops' websites. Check the internet connection and try again."
                elif total:
                    summary = f"{total} new prices from {ok} shop{'s' if ok != 1 else ''}"
                else:
                    summary = "No new pamphlets since the last check."
                self.state.update(running=False, finished_at=db.stamp(), summary=summary)
                self.last_finished = time.time()
            conn = db.connect(self.db_file)
            try:
                db.set_setting(conn, "last_refresh", json.dumps({"at": db.stamp(), "summary": self.state["summary"]}))
                conn.commit()
            finally:
                conn.close()
