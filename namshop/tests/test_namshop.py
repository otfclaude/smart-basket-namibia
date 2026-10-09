from datetime import timedelta

import pytest

from namshop import auth, db, deals, importer, logos, optimizer, sample


# ---------------------------------------------------------------- optimiser (pure)

def _opt(store, price, regular=None, brand="B"):
    regular = regular or price
    return {"store_id": store, "product_id": f"p-{brand}", "brand": brand, "price": price,
            "regular_price": regular, "on_special": price < regular, "saving": regular - price,
            "special_label": None, "valid_until": None, "source": "test"}


INFO = {k: {"item_id": k, "name": k, "size": "", "category": "", "brand": None} for k in "abcd"}
NAMES = {"s1": "Shop 1", "s2": "Shop 2", "s3": "Shop 3"}
OPTIONS = {
    "a": [_opt("s1", 10), _opt("s2", 12), _opt("s3", 15)],
    "b": [_opt("s1", 30), _opt("s2", 20), _opt("s3", 25)],
    "c": [_opt("s1", 8), _opt("s2", 9), _opt("s3", 5)],
    "d": [_opt("s2", 50, 60)],
}


def lines(**prio):
    return [optimizer.Line(k, 1, prio.get(k, "high")) for k in "abcd"]


def test_cheapest_split_across_shops():
    r = optimizer.optimize(INFO, OPTIONS, lines(), NAMES)
    assert r["status"] == "ok"
    assert r["total"] == 10 + 20 + 5 + 50
    assert {s["store_id"] for s in r["stores"]} == {"s1", "s2", "s3"}
    assert r["special_savings"] == 10


def test_max_one_shop_picks_cheapest_complete_shop():
    r = optimizer.optimize(INFO, OPTIONS, lines(), NAMES, max_stores=1)
    # only s2 sells everything
    assert [s["store_id"] for s in r["stores"]] == ["s2"]
    assert r["total"] == 12 + 20 + 9 + 50
    assert r["not_covered"] == []


def test_travel_cost_reduces_number_of_shops():
    r = optimizer.optimize(INFO, OPTIONS, lines(), NAMES, trip_cost=10)
    # 3 shops: 85 + 30 travel = 115; s2 alone: 91 + 10 = 101; s1+s2: (10+20+8+50)+20 = 108
    assert [s["store_id"] for s in r["stores"]] == ["s2"]
    assert r["total"] == 101
    assert r["travel"] == 10


def test_budget_keeps_must_haves_and_priorities():
    r = optimizer.optimize(INFO, OPTIONS, lines(d="must", a="low"), NAMES, budget=80)
    bought = {x["key"] for s in r["stores"] for x in s["items"]}
    assert "d" in bought                       # must-have always bought
    assert r["total"] <= 80
    assert {"b", "c"} <= bought                # high priority before low
    assert [x["key"] for x in r["left_out"]] == ["a"]
    assert r["budget_left"] == pytest.approx(80 - r["total"])


def test_budget_extra_units_count_less_than_first_unit():
    opts = {"a": [_opt("s1", 10)], "b": [_opt("s1", 10)]}
    info = {k: INFO[k] for k in "ab"}
    r = optimizer.optimize(info, opts, [optimizer.Line("a", 3), optimizer.Line("b", 1)], NAMES, budget=20)
    got = {x["key"]: x["qty"] for s in r["stores"] for x in s["items"]}
    assert got == {"a": 1, "b": 1}


def test_must_haves_over_budget_reports_shortfall():
    r = optimizer.optimize(INFO, OPTIONS, lines(d="must", b="must"), NAMES, budget=40)
    assert r["status"] == "over_budget"
    assert r["must_cost"] == 70
    assert r["shortfall"] == 30


def test_unavailable_items_are_reported():
    opts = dict(OPTIONS, d=[])
    r = optimizer.optimize(INFO, opts, lines(), NAMES)
    assert r["status"] == "partial"
    assert [x["key"] for x in r["unavailable"]] == ["d"]


# ---------------------------------------------------------------- catalogue, search, parsing

def test_seed_and_sample_data(conn):
    assert len(db.stores(conn)) >= 10
    n = conn.execute("SELECT COUNT(*) FROM prices WHERE source = 'sample'").fetchone()[0]
    assert n > 500
    sp = deals.specials(conn, limit=5)
    assert sp["total"] > 50
    assert all(x["price"] < x["regular_price"] for x in sp["results"])


@pytest.mark.parametrize("query,expected", [
    ("maize meal 10kg", "maize-meal-10kg"), ("pap", "maize-meal-10kg"), ("bread", "white-bread-600g"),
    ("cooking oil", "sunflower-oil-2l"), ("omo", "washing-powder-2kg"), ("toilet paper", "toilet-paper-9"),
    ("sugar", "sugar-white-2.5kg"), ("eggs", "eggs-18"), ("nappies", "nappies-size3"),
])
def test_search_finds_common_items(conn, query, expected):
    assert deals.search(conn, query, limit=1)[0]["id"] == expected


def test_parse_list_quantities_and_pack_sizes(conn):
    got = {x["text"]: (x["qty"], x["item"] and x["item"]["id"]) for x in deals.parse_list(
        conn, "2 x bread\n18 eggs\n3 eggs\ncooking oil x2\n9 toilet rolls\nunicorn steaks")}
    assert got["2 x bread"] == (2, "white-bread-600g")
    assert got["18 eggs"] == (1, "eggs-18")
    assert got["3 eggs"] == (3, "eggs-18")
    assert got["cooking oil x2"] == (2, "sunflower-oil-2l")
    assert got["9 toilet rolls"] == (1, "toilet-paper-9")
    assert got["unicorn steaks"] == (1, None)


# ---------------------------------------------------------------- imports & reports

def test_csv_import_matches_creates_and_reports_errors(conn):
    until = (db.today() + timedelta(days=5)).isoformat()
    text = ("store,item,size,brand,price,special_price,special_label,valid_until\n"
            f"Shoprite,Super maize meal,10kg,Top Score,139.99,99.99,Leaflet,{until}\n"
            f"pick n pay,Top Score Super Maize Meal 10kg,,,N$141.99,104.99,,{until}\n"
            "SPAR,Kapana spice,200g,Local,25,,,\n"
            "Nowhere,Rice,2kg,Tastic,50,,,\n"
            "Checkers,Rice,2kg,Tastic,abc,,,\n")
    res = importer.import_text(conn, text, source="import:test")
    assert res["imported"] == 3
    assert len(res["errors"]) == 2 and "row 5" in res["errors"][0] and "row 6" in res["errors"][1]
    rows = {r["store_id"]: r for r in conn.execute(
        "SELECT * FROM prices WHERE product_id = 'maize-meal-10kg--top-score' AND source = 'import:test'")}
    assert rows["shoprite"]["special_price"] == 99.99
    assert rows["model"]["price"] == 141.99   # "Pick n Pay" is now Model; brand and size peeled off the name
    assert conn.execute("SELECT unit, qty FROM items WHERE id = 'kapana-spice-200g'").fetchone()[:] == ("kg", 0.2)
    best = deals.item_prices(conn, "maize-meal-10kg", ["shoprite"])
    assert any(p["on_special"] and p["price"] == 99.99 and p["source"] == "import:test" for p in best)


def test_json_import_and_bad_special(conn):
    res = importer.import_text(conn, '[{"store": "usave", "product_id": "rice-2kg--tastic", "price": 50, '
                                     '"special_price": 60}]')
    assert res["imported"] == 0 and "higher" in res["errors"][0]


def test_real_prices_survive_sample_regeneration(conn):
    importer.import_text(conn, "store,product_id,price\nspar,rice-2kg--tastic,77.77\n", source="import:x")
    sample.ensure_sample(conn, force=True)
    row = conn.execute("SELECT price, source FROM prices WHERE store_id='spar' AND product_id='rice-2kg--tastic'").fetchone()
    assert tuple(row) == (77.77, "import:x")
    sample.set_enabled(conn, False)
    assert conn.execute("SELECT COUNT(*) FROM prices WHERE source='sample'").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0] == 1


def test_community_report_validation(conn):
    u = auth.register(conn, "Tester", "t@example.com", "password123")
    pid = conn.execute("SELECT product_id FROM prices WHERE store_id = 'shoprite' LIMIT 1").fetchone()[0]
    regular = conn.execute("SELECT price FROM prices WHERE store_id='shoprite' AND product_id=?", (pid,)).fetchone()[0]
    with pytest.raises(importer.ImportProblem):
        importer.report_special(conn, u["id"], "shoprite", regular + 1, product_id_=pid)
    with pytest.raises(importer.ImportProblem):
        importer.report_special(conn, u["id"], "shoprite", 1.0, product_id_=pid,
                                valid_until=(db.today() - timedelta(days=1)).isoformat())
    importer.report_special(conn, u["id"], "shoprite", round(regular * 0.5, 2), product_id_=pid, label="Pay-day")
    p = [x for x in deals.item_prices(conn, pid.split("--")[0], ["shoprite"]) if x["product_id"] == pid][0]
    assert p["on_special"] and p["source"] == "community" and p["reporter"] == "Tester"


# ---------------------------------------------------------------- accounts

def test_register_login_and_throttle(conn):
    auth.register(conn, "Anna", "Anna@Example.com", "longpassword")
    with pytest.raises(auth.AuthError):
        auth.register(conn, "Anna", "anna@example.com", "longpassword")
    with pytest.raises(auth.AuthError):
        auth.register(conn, "Bob", "bob@example.com", "short")
    assert auth.login(conn, "ANNA@example.com", "longpassword")["name"] == "Anna"
    for _ in range(auth._Throttle.LIMIT):
        with pytest.raises(auth.AuthError):
            auth.login(conn, "anna@example.com", "wrong-password")
    with pytest.raises(auth.AuthError, match="Too many"):
        auth.login(conn, "anna@example.com", "longpassword")
    auth.throttle.clear("anna@example.com")


def test_password_hash_roundtrip():
    h = auth.hash_password("secret-pass")
    assert auth.verify_password("secret-pass", h)
    assert not auth.verify_password("other", h)
    assert not auth.verify_password("x", "garbage")


def test_logo_badge_is_valid_svg_and_escapes():
    svg = logos.badge_svg('A&B <shop>', {"bg": "#000", "lines": ["A&B <shop>"]})
    assert svg.startswith("<svg") and "&amp;" in svg and "<shop>" not in svg


# ---------------------------------------------------------------- HTTP API

def test_api_end_to_end(client):
    meta = client.get("/api/meta").json()
    assert meta["user"] is None and meta["sample_data"] and len(meta["stores"]) >= 10
    assert client.get("/").status_code == 200
    assert client.get("/logos/shoprite.svg").headers["content-type"].startswith("image/svg")
    assert client.get("/api/specials?limit=3").json()["total"] > 0
    item = client.get("/api/search", params={"q": "maize meal"}).json()["results"][0]

    # anonymous users can build carts
    body = {"lines": [{"key": "1", "item_id": item["id"], "qty": 2},
                      {"key": "2", "item_id": "sunflower-oil-2l", "qty": 1}], "max_stores": 2}
    r = client.post("/api/cart/optimize", json=body).json()
    assert r["status"] == "ok" and r["items_bought"] == 3 and len(r["stores"]) <= 2
    r = client.post("/api/cart/optimize", json={**body, "budget": 10}).json()
    assert r["total"] <= 10

    # but need an account to save lists or report specials
    assert client.get("/api/lists").status_code == 401
    assert client.post("/api/reports", json={"store_id": "spar", "special_price": 1}).status_code == 401
    reg = client.post("/api/auth/register", json={"name": "Ndapewa", "email": "n@example.com",
                                                  "password": "secret123", "town": "Oshakati"})
    assert reg.status_code == 200 and "nsb_session" in reg.cookies
    assert client.get("/api/me").json()["town"] == "Oshakati"
    saved = client.post("/api/lists", json={"name": "Month-end", "data": {"lines": body["lines"]}}).json()
    assert client.get("/api/lists").json()["lists"][0]["id"] == saved["id"]
    assert client.patch("/api/me", json={"stores": ["shoprite", "nope"]}).json()["stores"] == ["shoprite"]
    assert client.get("/api/admin/summary").status_code == 403

    # another user can't see or delete the first user's list
    client.post("/api/auth/logout")
    client.post("/api/auth/register", json={"name": "Other", "email": "o@example.com", "password": "secret123"})
    assert client.get("/api/lists").json()["lists"] == []
    client.delete(f"/api/lists/{saved['id']}")
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "n@example.com", "password": "secret123"})
    assert len(client.get("/api/lists").json()["lists"]) == 1

    bad = client.post("/api/auth/login", json={"email": "n@example.com", "password": "nope"})
    assert bad.status_code == 400


def test_api_admin_import(client):
    client.post("/api/auth/register", json={"name": "Admin", "email": "a@example.com", "password": "secret123"})
    c = db.connect(client.app.state.db_file)
    auth.make_admin(c, "a@example.com")
    c.close()
    res = client.post("/api/admin/import", json={"text": "store,product_id,price,special_price\n"
                                                         "checkers,rice-2kg--tastic,55,33.33\n"}).json()
    assert res == {"imported": 1, "errors": []}
    prices = client.get("/api/items/rice-2kg", params={"stores": "checkers"}).json()["prices"]
    assert any(p["price"] == 33.33 and p["on_special"] for p in prices)
    assert client.post("/api/admin/sample", json={"enabled": False}).json()["sample_enabled"] is False
    assert client.get("/api/meta").json()["sample_data"] is False


def test_api_pamphlets_refresh_and_baskets(client, monkeypatch):
    from namshop import leaflets
    monkeypatch.setattr(leaflets, "sources", lambda: {})          # no network in tests
    monkeypatch.setattr(logos, "fetch_logos", lambda *a, **k: {})
    assert client.get("/api/leaflets").json()["leaflets"] == []
    s = client.post("/api/refresh", json={}).json()
    assert "running" in s and "claude" in s
    assert client.get("/api/refresh/status").status_code == 200
    assert client.get("/leaflets/shoprite/..%2F..%2Fnamshop.db").status_code == 404
    baskets = client.get("/api/baskets").json()["baskets"]
    assert len(baskets) >= 5 and all(b["total"] and b["stores"] for b in baskets)
    assert client.post("/api/admin/claude-key", json={"key": "sk-ant-" + "x" * 30}).status_code == 401
    meta = client.get("/api/meta").json()
    assert meta["claude"] in (True, False) and "logo_version" in meta
    assert [s["id"] for s in meta["stores"]].count("model") == 1 and "picknpay" not in [s["id"] for s in meta["stores"]]


def test_local_desktop_mode(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from namshop import leaflets
    from namshop.server import create_app
    monkeypatch.setenv("NAMSHOP_LOCAL", "1")
    monkeypatch.setattr(leaflets, "_key_file", lambda: tmp_path / "anthropic_api_key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with TestClient(create_app(tmp_path / "local.db", refresh_hours=0), base_url="http://127.0.0.1:47826") as c:
        assert c.get("/api/meta").json()["local"] is True
        assert c.get("/healthz").json()["app"] == "smart-basket"
        first = c.post("/api/auth/register", json={"name": "Owner", "email": "o@example.com", "password": "secret123"}).json()
        assert first["is_admin"] is True                      # the Mac's owner manages the app
        c.post("/api/auth/logout")
        second = c.post("/api/auth/register", json={"name": "Kid", "email": "k@example.com", "password": "secret123"}).json()
        assert second["is_admin"] is False
        c.post("/api/auth/logout")
        assert c.post("/api/admin/claude-key", json={"key": "sk-ant-" + "x" * 30}).json()["claude"] is True
        assert c.get("/api/meta", headers={"host": "attacker.example"}).status_code == 400   # DNS rebinding


def test_server_mode_claude_key_needs_admin(client):
    assert client.post("/api/admin/claude-key", json={"key": "sk-ant-" + "x" * 30}).status_code == 401
    client.post("/api/auth/register", json={"name": "A", "email": "a2@example.com", "password": "secret123"})
    assert client.post("/api/admin/claude-key", json={"key": "sk-ant-" + "x" * 30}).status_code == 403
    assert client.get("/api/meta").json()["local"] is False


def test_desktop_selftest_serves_the_real_app(tmp_path, monkeypatch):
    from namshop import desktop
    monkeypatch.setenv("NAMSHOP_LOCAL", "1")
    monkeypatch.setenv("NAMSHOP_DATA", str(tmp_path / "unused"))
    monkeypatch.setenv("NAMSHOP_SELFTEST_OUT", str(tmp_path / "selftest.txt"))
    monkeypatch.setenv("NAMSHOP_PBKDF2_ITERATIONS", "1000")
    assert desktop.selftest() == 0, (tmp_path / "selftest.txt").read_text()
    report = (tmp_path / "selftest.txt").read_text()
    assert report.startswith("SELFTEST OK") and "budget cart" in report and "anthropic" in report
