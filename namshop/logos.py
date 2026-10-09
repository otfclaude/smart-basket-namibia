"""Shop logos.

Real logos are downloaded by :func:`fetch_logos` (at start-up and on every Refresh) from each
shop's own website (the header logo, or its app icon) or from the Wikimedia Commons files
listed in stores.json, and cached in ``<data dir>/logos``. A file you put there yourself, or in
the package's ``static/logos``, works the same way. Until a logo is available a badge is drawn in
the shop's colours.
"""
from __future__ import annotations

import json
import re
from html import escape
from pathlib import Path

from . import STATIC_DIR, data_dir, net

EXTS = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon"}


def logo_file(store_id: str) -> tuple[Path, str] | None:
    for folder in (data_dir() / "logos", STATIC_DIR / "logos"):
        for ext, mime in EXTS.items():
            p = folder / f"{store_id}{ext}"
            if p.is_file():
                return p, mime
    return None


def _em_width(text: str) -> float:
    """Rough rendered width of text in a heavy sans-serif, in ems."""
    w = 0.0
    for ch in text:
        if ch in "WM":
            w += 1.0
        elif ch.isupper() or ch.isdigit():
            w += 0.78
        elif ch in " '.-":
            w += 0.32
        else:
            w += 0.64
    return max(w, 1.0)


def _fit(text: str, cap: float, width: float = 176) -> int:
    return int(min(cap, width / _em_width(text)))


def badge_svg(name: str, logo: dict) -> str:
    bg = logo.get("bg", "#333333")
    fg = logo.get("fg", "#FFFFFF")
    accent = logo.get("accent", fg)
    lines = logo.get("lines") or [name]
    w, h = 200, 80
    if len(lines) == 1:
        size = _fit(lines[0], 40)
        body = (f'<text x="100" y="{36 + size * 0.36:.0f}" font-size="{size}" text-anchor="middle">'
                f'{escape(lines[0])}</text>')
    else:
        sa, sb = _fit(lines[0], 30), _fit(lines[1], 21)
        ya = 9 + sa * 0.92
        yb = ya + 4 + sb * 0.95
        body = (f'<text x="100" y="{ya:.0f}" font-size="{sa}" text-anchor="middle">{escape(lines[0])}</text>'
                f'<text x="100" y="{yb:.0f}" font-size="{sb}" text-anchor="middle" opacity="0.95">'
                f'{escape(lines[1])}</text>')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(name)}">'
        f'<clipPath id="c"><rect width="{w}" height="{h}" rx="16"/></clipPath>'
        f'<g clip-path="url(#c)"><rect width="{w}" height="{h}" fill="{escape(bg)}"/>'
        f'<rect y="{h - 8}" width="{w}" height="8" fill="{escape(accent)}"/></g>'
        f'<g fill="{escape(fg)}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900" '
        f'letter-spacing="-0.5">{body}</g></svg>')


# ---------------------------------------------------------------- real logos

_SCRIPT = re.compile(r"<\s*(script|foreignObject)\b.*?<\s*/\s*\1\s*>", re.I | re.S)
_EVENT = re.compile(r"""\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_JS_HREF = re.compile(r"""(href\s*=\s*["'])\s*javascript:[^"']*""", re.I)


def sanitize_svg(body: bytes) -> bytes:
    """Strip scripts, event handlers and javascript: links from an SVG."""
    text = body.decode("utf-8", errors="replace")
    text = _SCRIPT.sub("", text)
    text = re.sub(r"<\s*(script|foreignObject)\b[^>]*/\s*>", "", text, flags=re.I)
    text = _EVENT.sub("", text)
    text = _JS_HREF.sub(r"\1#", text)
    return text.encode("utf-8")


def logo_candidates(homepage: str, fetch_text=net.fetch_text) -> list[str]:
    """Likely logo URLs on a shop's homepage: header logo images first, then app icons."""
    html, final = fetch_text(homepage)
    links, _ = net.page_links(html, final)
    def score(ln):
        u, ctx = ln["url"].lower(), (ln["url"] + " " + ln["text"]).lower()
        if ln["tag"] == "img" and "logo" in ctx:
            return 0 if u.split("?")[0].endswith((".svg", ".png", ".webp")) else 1
        if ln.get("rel") and "apple-touch-icon" in ln["rel"]:
            return 2
        if ln.get("rel") and "icon" in ln["rel"] and not u.split("?")[0].endswith(".ico"):
            return 3
        return None
    ranked = sorted(((score(ln), i, ln["url"]) for i, ln in enumerate(links) if score(ln) is not None))
    return [u for _, _, u in ranked][:5]


def _save(store_id: str, body: bytes, kind: str):
    folder = data_dir() / "logos"
    folder.mkdir(parents=True, exist_ok=True)
    for ext in EXTS:
        old = folder / f"{store_id}{ext}"
        if old.exists():
            old.unlink()
    (folder / f"{store_id}{net.EXT[kind]}").write_bytes(body)


def fetch_logos(conn, fetch=net.fetch, fetch_text=net.fetch_text, force: bool = False) -> dict[str, str]:
    """Download real logos for shops that don't have one yet. Returns {shop id: source URL}."""
    from . import db
    got = {}
    for s in db.stores(conn):
        sid = s["id"]
        cached = logo_file(sid)
        if cached and not force:
            continue
        for src in s["logo"].get("urls", []):
            try:
                cands = logo_candidates(src[5:], fetch_text) if src.startswith("site:") else [src]
            except Exception:
                continue
            for url in cands:
                try:
                    body, _, _ = fetch(url, 3_000_000, 20)
                except Exception:
                    continue
                kind = net.file_kind(body)
                if kind not in ("svg", "png", "jpeg", "webp", "gif", "ico") or (kind != "svg" and len(body) < 400):
                    continue
                _save(sid, sanitize_svg(body) if kind == "svg" else body, kind)
                got[sid] = url
                break
            if sid in got:
                break
    if got:
        from . import db as _db
        _db.set_setting(conn, "logo_version", json.dumps(sorted(got.items())))
        conn.commit()
    return got
