"""Pamphlet fetching, Claude reading and logo download, against a fake internet."""
import json
import time

import pytest

from namshop import db, deals, leaflets, logos, net

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 40_000
PDF = b"%PDF-1.4\n" + b"0" * 5_000
SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">'
       b'<script>alert(2)</script><a href="javascript:alert(3)"><rect width="10" height="10"/></a></svg>')

SITES = {
    "https://www.shoprite.com.na/robots.txt": "User-agent: *\nDisallow: /private/\n",
    "https://www.shoprite.com.na/specials.html": """
        <div class="cmp-leaflets-specials__leaflets">
          <button class="cmp-leaflets-specials__leaflets__item__catalogue"
                  data-leaflet-external-url="https://specials.shoprite.com.na/deals/nashopriteprice06oct19oct2026/"
                  aria-label="Shoprite price leaflet">View</button>
          <img src="/content/dam/logo.png" alt="Shoprite logo">
        </div>""",
    "https://specials.shoprite.com.na/robots.txt": "",
    "https://specials.shoprite.com.na/deals/nashopriteprice06oct19oct2026/": "<html><title>Prices</title></html>",
    **{f"https://specials.shoprite.com.na/deals/nashopriteprice06oct19oct2026/{n}/":
       f'<meta property="og:image" content="../files/assets/common/page-html5-substrates/page{n:04d}_4.jpg">'
       for n in (1, 2, 3)},
    "https://www.woermannbrock.com/robots.txt": "User-agent: *\nDisallow:\n",
    "https://www.woermannbrock.com/special-offers/supermarkets-special-offers": """
        <title>Supermarket specials</title>
        <a href="/images/leaflets/WB-Supermarket-Specials-Oct.pdf">Download this week's leaflet</a>
        <img src="/images/social/facebook.png">""",
    "https://blocked.example.na/robots.txt": "User-agent: *\nDisallow: /\n",
}
FILES = {
    **{f"https://specials.shoprite.com.na/deals/nashopriteprice06oct19oct2026/files/assets/common/"
       f"page-html5-substrates/page{n:04d}_4.jpg": JPEG + bytes([n]) for n in (1, 2, 3)},
    "https://www.woermannbrock.com/images/leaflets/WB-Supermarket-Specials-Oct.pdf": PDF,
    "https://www.shoprite.com.na/content/dam/logo.png": b"\x89PNG\r\n\x1a\n" + b"\x01" * 2000,
    "https://www.woermannbrock.com/templates/wb/logo.svg": SVG,
}


def fake_text(url):
    if url not in SITES:
        raise net.FetchError(f"404 {url}")
    return SITES[url], url


def fake_fetch(url, max_bytes=net.MAX_FILE, timeout=30):
    if url in FILES:
        return FILES[url], "application/octet-stream", url
    if url in SITES:
        return SITES[url].encode(), "text/html", url
    raise net.FetchError(f"404 {url}")


def fake_reader(shop, files, categories):
    fake_reader.calls += 1
    return {"title": f"{shop} specials", "valid_from": db.today().isoformat(),
            "valid_until": db.today().replace(day=28).isoformat() if db.today().day < 28 else "",
            "products": [
                {"item": "Super maize meal", "brand": "Top Score", "size": "10kg", "category": "Staples & grains",
                 "price": 149.99, "special_price": 99.99, "label": "Price lock", "valid_until": ""},
                {"item": "Sunflower cooking oil", "brand": "Sunfoil", "size": "2L", "category": "Pantry & tins",
                 "price": 0, "special_price": 54.99, "label": "", "valid_until": ""},
                {"item": "Kapana spice", "brand": "", "size": "200g", "category": "Pantry & tins",
                 "price": 0, "special_price": 0, "label": "", "valid_until": ""},
            ]}


fake_reader.calls = 0


@pytest.fixture(autouse=True)
def _reset_robots():
    net._robots.clear()


def test_link_discovery_finds_data_urls_and_files():
    links, title = net.page_links(SITES["https://www.shoprite.com.na/specials.html"],
                                  "https://www.shoprite.com.na/specials.html")
    urls = [ln["url"] for ln in links]
    assert "https://specials.shoprite.com.na/deals/nashopriteprice06oct19oct2026/" in urls
    assert "https://www.shoprite.com.na/content/dam/logo.png" in urls


def test_flipbook_pages_become_one_image_pamphlet():
    src = {"url": "https://www.shoprite.com.na/specials.html", "flipbooks": r"specials\.shoprite\.com\.na/deals/"}
    found = leaflets.find_pamphlets("shoprite", src, fake_text)
    assert len(found) == 1 and found[0].kind == "flipbook"
    p = leaflets.download(found[0], fake_fetch, fake_text)
    assert p.kind == "images" and len(p.files) == 3


def test_pdf_link_on_page_and_icons_ignored():
    src = {"url": "https://www.woermannbrock.com/special-offers/supermarkets-special-offers"}
    found = leaflets.find_pamphlets("woermannbrock", src, fake_text)
    assert [p.urls for p in found] == [["https://www.woermannbrock.com/images/leaflets/WB-Supermarket-Specials-Oct.pdf"]]


def test_refresh_store_reads_imports_and_skips_repeats(conn):
    fake_reader.calls = 0
    srcs = [{"url": "https://www.shoprite.com.na/specials.html", "flipbooks": r"specials\.shoprite\.com\.na/deals/"}]
    steps = []
    res = leaflets.refresh_store(conn, "shoprite", "Shoprite", srcs, db.categories(conn),
                                 lambda st, msg: steps.append(st), fake_fetch, fake_text, fake_reader)
    assert res["state"] == "done" and res["specials"] == 2 and fake_reader.calls == 1
    assert steps[:3] == ["searching", "downloading", "reading"]
    sp = {x["name"]: x for x in deals.specials(conn, stores=["shoprite"], limit=500)["results"]
          if x["source"] == "leaflet:shoprite"}
    assert sp["Super maize meal"]["price"] == 99.99 and sp["Super maize meal"]["saving"] == 50
    assert sp["Sunflower cooking oil"]["price"] == 54.99          # no "was" price: still listed as a special
    lst = leaflets.list_leaflets(conn)
    assert lst[0]["status"] == "read" and lst[0]["pages"] == 3 and lst[0]["n_specials"] == 2
    assert leaflets.leaflet_path("shoprite", lst[0]["files"][0].rsplit("/", 1)[1]) is not None
    assert leaflets.leaflet_path("shoprite", "../../namshop.db") is None
    again = leaflets.refresh_store(conn, "shoprite", "Shoprite", srcs, db.categories(conn),
                                   lambda *a: None, fake_fetch, fake_text, fake_reader)
    assert again["message"] == "Already up to date." and fake_reader.calls == 1


def test_without_claude_pamphlets_are_kept_for_browsing(conn, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    srcs = [{"url": "https://www.woermannbrock.com/special-offers/supermarkets-special-offers"}]
    res = leaflets.refresh_store(conn, "woermannbrock", "Woermann Brock", srcs, [], lambda *a: None,
                                 fake_fetch, fake_text, None)
    assert res["state"] == "done" and "Claude" in res["message"]
    assert leaflets.list_leaflets(conn)[0]["status"] == "stored"


def test_robots_txt_is_respected(conn):
    srcs = [{"url": "https://blocked.example.na/specials"}]
    res = leaflets.refresh_store(conn, "spar", "SPAR", srcs, [], lambda *a: None, fake_fetch, fake_text, fake_reader)
    assert res["state"] == "error" and "asks apps not to fetch" in res["errors"][0]


def test_refresh_manager_runs_in_background(tmp_path, monkeypatch):
    c = db.connect(tmp_path / "r.db")
    db.init_db(c)
    c.close()
    monkeypatch.setattr(leaflets, "sources", lambda: {
        "shoprite": [{"url": "https://www.shoprite.com.na/specials.html",
                      "flipbooks": r"specials\.shoprite\.com\.na/deals/"}],
        "woermannbrock": [{"url": "https://www.woermannbrock.com/special-offers/supermarkets-special-offers"}],
        "spar": [{"url": "https://nowhere.example.na/"}]})
    m = leaflets.RefreshManager(str(tmp_path / "r.db"))
    m.fetch, m.fetch_text, m.reader = fake_fetch, fake_text, fake_reader
    s = m.start()
    assert s["running"] and set(s["shops"]) == {"shoprite", "woermannbrock", "spar"}
    for _ in range(100):
        if not m.status()["running"]:
            break
        time.sleep(0.05)
    s = m.status()
    assert not s["running"] and s["shops"]["shoprite"]["state"] == "done"
    assert s["shops"]["spar"]["state"] == "error"
    assert s["summary"] == "4 new prices from 2 shops"
    assert m.start()["next_allowed_in"] > 0          # a second press right away doesn't refetch


def test_claude_request_shape():
    """The SDK accepts our request and we parse the streamed JSON answer."""
    import anthropic
    import httpx2
    seen = {"bodies": []}
    answer = json.dumps({"title": "Weekly", "valid_from": "2026-10-06", "valid_until": "2026-10-19",
                         "products": [{"item": "Rice", "brand": "Tastic", "size": "2kg", "category": "Staples & grains",
                                       "price": 59.99, "special_price": 44.99, "label": "", "valid_until": ""}]})
    events = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_1", "type": "message", "role": "assistant", "model": leaflets.MODEL, "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0,
                                 "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0,
                                 "delta": {"type": "text_delta", "text": answer}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                           "usage": {"output_tokens": 50}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    sse = "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events)

    def handler(request):
        seen["bodies"].append(json.loads(request.content))
        seen["beta"] = request.headers.get("anthropic-beta")
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, text=sse)

    client = anthropic.Anthropic(api_key="test-key", http_client=anthropic.DefaultHttpxClient(
        transport=httpx2.MockTransport(handler)))
    data = leaflets.read_with_claude("Checkers", [(PDF, "pdf"), (JPEG, "jpeg")], ["Staples & grains"], client)
    assert data["products"][0]["special_price"] == 44.99 and data["valid_until"] == "2026-10-19"
    assert len(seen["bodies"]) == 2                    # the PDF and the page images go in separate requests
    body = seen["bodies"][0]
    assert body["model"] == leaflets.MODEL and body["stream"] is True
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in seen["beta"]
    assert [b["type"] for b in body["messages"][0]["content"]] == ["document", "text"]
    assert [b["type"] for b in seen["bodies"][1]["messages"][0]["content"]] == ["image", "text"]
    assert body["messages"][0]["content"][0]["source"]["media_type"] == "application/pdf"
    rows = leaflets.to_rows("checkers", data)
    assert rows[0]["price"] == "59.99" and rows[0]["special_price"] == "44.99"


def test_logos_downloaded_from_site_and_sanitised(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(logos, "data_dir", lambda: tmp_path)
    SITES["https://www.woermannbrock.com/"] = '<header><img src="/templates/wb/logo.svg" alt="Woermann Brock"></header>'
    SITES["https://www.shoprite.com.na/"] = SITES["https://www.shoprite.com.na/specials.html"]
    got = logos.fetch_logos(conn, fetch=fake_fetch, fetch_text=fake_text)
    assert got["woermannbrock"].endswith("logo.svg") and got["shoprite"].endswith("logo.png")
    svg = (tmp_path / "logos" / "woermannbrock.svg").read_bytes()
    assert b"<script" not in svg and b"onload" not in svg and b"javascript:" not in svg
    assert logos.fetch_logos(conn, fetch=fake_fetch, fetch_text=fake_text) == {}   # cached
