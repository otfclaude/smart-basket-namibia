"""Polite HTTP fetching: browser-like headers, size caps, robots.txt, link discovery in HTML."""
from __future__ import annotations

import json
import re
import urllib.request
import urllib.robotparser
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0 Safari/537.36 SmartBasketNamibia/1.1")
BOT = "SmartBasketNamibia"
MAX_PAGE = 4_000_000
MAX_FILE = 30_000_000


class FetchError(RuntimeError):
    pass


def fetch(url: str, max_bytes: int = MAX_FILE, timeout: int = 30) -> tuple[bytes, str, str]:
    """GET a URL. Returns (body, content type, final URL)."""
    if urlparse(url).scheme not in ("http", "https"):
        raise FetchError(f"not a web address: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*",
                                               "Accept-Language": "en-NA,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(max_bytes + 1)
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            final = r.geturl()
    except OSError as e:  # URLError, HTTPError, timeouts
        raise FetchError(f"couldn't download {url}: {e}") from e
    if len(body) > max_bytes:
        raise FetchError(f"{url} is larger than {max_bytes // 1_000_000} MB")
    return body, ctype, final


def fetch_text(url: str) -> tuple[str, str]:
    body, _, final = fetch(url, MAX_PAGE)
    return body.decode("utf-8", errors="replace"), final


_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}


def allowed(url: str, fetcher=None) -> bool:
    """True unless the site's robots.txt disallows us. Unreachable robots.txt counts as allowed."""
    p = urlparse(url)
    root = f"{p.scheme}://{p.netloc}"
    if root not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            text, _ = (fetcher or fetch_text)(root + "/robots.txt")
            rp.parse(text.splitlines())
            _robots[root] = rp
        except Exception:
            _robots[root] = None
    rp = _robots[root]
    return True if rp is None else rp.can_fetch(BOT, url)


def file_kind(body: bytes) -> str | None:
    """Recognise a file by its first bytes: pdf, png, jpeg, webp, gif, svg, ico."""
    head = body[:512].lstrip()
    if body[:4] == b"%PDF":
        return "pdf"
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if body[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "webp"
    if body[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if body[:4] == b"\x00\x00\x01\x00":
        return "ico"
    if head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in head:
        return "svg"
    return None


MIME = {"pdf": "application/pdf", "png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp",
        "gif": "image/gif", "svg": "image/svg+xml", "ico": "image/x-icon"}
EXT = {"pdf": ".pdf", "png": ".png", "jpeg": ".jpg", "webp": ".webp", "gif": ".gif", "svg": ".svg", "ico": ".ico"}


class _Links(HTMLParser):
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.links: list[dict] = []
        self.title = ""
        self._a: dict | None = None
        self._in_title = False

    def _add(self, url, tag, text="", rel=""):
        url = (url or "").strip()
        if not url or url.startswith(("data:", "javascript:", "mailto:", "tel:", "#")):
            return
        self.links.append({"url": urljoin(self.base, url), "tag": tag, "text": text.strip()[:200], "rel": rel})

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        for k, v in a.items():  # e.g. <button data-leaflet-external-url="https://...">
            if k.startswith("data-") and ("url" in k or "href" in k) and v.startswith(("http", "/")):
                self._add(v, "data", a.get("aria-label") or a.get("title") or "")
        if tag == "base" and a.get("href"):
            self.base = urljoin(self.base, a["href"])
        elif tag == "a":
            self._a = {"href": a.get("href"), "text": a.get("title") or a.get("aria-label") or ""}
        elif tag in ("img", "source"):
            alt = a.get("alt") or a.get("title") or ""
            alt += " " + a.get("class", "") + " " + a.get("id", "")
            for key in ("data-src", "data-lazy-src", "data-original", "data-full", "data-zoom-image", "src"):
                if a.get(key):
                    self._add(a[key], "img", alt)
                    break
            for key in ("srcset", "data-srcset"):
                if a.get(key):  # take the largest candidate
                    parts = [p.strip().split(" ")[0] for p in a[key].split(",") if p.strip()]
                    if parts:
                        self._add(parts[-1], "img", alt)
            if self._a is not None:
                self._a["text"] += " " + alt
        elif tag in ("iframe", "embed"):
            self._add(a.get("src") or a.get("data-src"), tag, a.get("title", ""))
        elif tag == "object":
            self._add(a.get("data"), "object")
        elif tag == "link":
            self._add(a.get("href"), "link", rel=a.get("rel", "").lower())
        elif tag == "meta" and a.get("property", a.get("name", "")).lower() in ("og:image", "twitter:image"):
            self._add(a.get("content"), "meta", rel="og:image")
        elif tag == "title":
            self._in_title = True

    def handle_data(self, data):
        if self._a is not None:
            self._a["text"] += data
        if self._in_title:
            self.title += data

    def handle_endtag(self, tag):
        if tag == "a" and self._a is not None:
            self._add(self._a["href"], "a", " ".join(self._a["text"].split()))
            self._a = None
        elif tag == "title":
            self._in_title = False


_URL_IN_TEXT = re.compile(r"""https?:\\?/\\?/[^"'\s<>()]+?\.(?:pdf|jpe?g|png|webp)(?:\?[^"'\s<>()]*)?""", re.I)


def page_links(html: str, base: str) -> tuple[list[dict], str]:
    """Every link, image, frame and embedded file URL on a page, plus the page title."""
    p = _Links(base)
    try:
        p.feed(html)
    except Exception:  # malformed HTML: keep whatever was parsed
        pass
    links = p.links
    for m in _URL_IN_TEXT.finditer(html):  # file URLs inside scripts / JSON
        links.append({"url": unescape(m.group(0).replace("\\/", "/")), "tag": "text", "text": "", "rel": ""})
    seen, out = set(), []
    for ln in links:
        if ln["url"] not in seen:
            seen.add(ln["url"])
            out.append(ln)
    return out, " ".join(p.title.split())


def json_or_none(text: str):
    try:
        return json.loads(text)
    except ValueError:
        return None
