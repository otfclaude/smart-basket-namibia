"""Shop logos.

A real logo file dropped into ``<data dir>/logos/<shop id>.(svg|png|jpg|webp)`` (or the
package's ``static/logos``) is used when present. Otherwise a badge is drawn in the shop's
colours from the settings in stores.json.
"""
from __future__ import annotations

from html import escape
from pathlib import Path

from . import STATIC_DIR, data_dir

EXTS = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp"}


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
