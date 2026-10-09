"""Web server: JSON API + the single-page app. Run with ``python -m namshop serve``."""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
import zlib
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import BUNDLED_DATA, STATIC_DIR, __version__, auth, db, deals, importer, leaflets, logos, optimizer, sample

COOKIE = "nsb_session"


# ---------------------------------------------------------------- request bodies

class RegisterIn(BaseModel):
    name: str = Field(max_length=60)
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)
    town: str = Field("", max_length=60)


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class ProfileIn(BaseModel):
    name: str | None = Field(None, max_length=60)
    town: str | None = Field(None, max_length=60)
    stores: list[str] | None = Field(None, max_length=50)


class PasswordIn(BaseModel):
    old: str = Field(max_length=200)
    new: str = Field(max_length=200)


class LineIn(BaseModel):
    key: str = Field(max_length=40)
    item_id: str | None = Field(None, max_length=120)
    product_id: str | None = Field(None, max_length=160)
    qty: int = Field(1, ge=1, le=99)
    priority: str = Field("high", pattern="^(must|high|medium|low)$")


class OptimizeIn(BaseModel):
    lines: list[LineIn] = Field(max_length=150)
    stores: list[str] | None = Field(None, max_length=50)
    max_stores: int | None = Field(None, ge=1, le=50)
    trip_cost: float = Field(0, ge=0, le=5000)
    budget: float | None = Field(None, ge=0, le=1_000_000)


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    data: dict


class ParseIn(BaseModel):
    text: str = Field(max_length=5000)


class ReportIn(BaseModel):
    store_id: str = Field(max_length=40)
    product_id: str | None = Field(None, max_length=160)
    item_id: str | None = Field(None, max_length=120)
    brand: str | None = Field(None, max_length=40)
    special_price: float = Field(gt=0, lt=100_000)
    price: float | None = Field(None, gt=0, lt=100_000)
    label: str | None = Field(None, max_length=60)
    valid_until: str | None = Field(None, max_length=10, pattern=r"^\d{4}-\d{2}-\d{2}$")
    branch: str | None = Field(None, max_length=60)


class ImportIn(BaseModel):
    text: str = Field(max_length=3_000_000)
    format: str | None = Field(None, pattern="^(csv|json)$")
    store: str | None = Field(None, max_length=40)


class SampleIn(BaseModel):
    enabled: bool


class RefreshIn(BaseModel):
    force: bool = False


class KeyIn(BaseModel):
    key: str = Field(min_length=20, max_length=300)


# ---------------------------------------------------------------- app

def get_conn(request: Request):
    c = db.connect(request.app.state.db_file)
    try:
        yield c
    finally:
        c.close()


Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


def create_app(db_file: str | Path | None = None, refresh_hours: float | None = None) -> FastAPI:
    """``refresh_hours``: fetch pamphlets, feeds and logos this often while running (0 = only on demand)."""
    db_file = str(db_file or db.db_path())
    conn = db.connect(db_file)
    db.init_db(conn)
    sample.ensure_sample(conn)
    conn.close()
    hours = refresh_hours if refresh_hours is not None else float(os.environ.get("NAMSHOP_REFRESH_HOURS", "6"))
    refresher = leaflets.RefreshManager(db_file)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = None
        if hours > 0:
            async def loop():
                while True:
                    c = db.connect(db_file)
                    try:
                        last = json.loads(db.get_setting(c, "last_refresh", "{}") or "{}").get("at", "")
                    finally:
                        c.close()
                    age = (time.time() - _ts(last)) if last else 1e9
                    if age >= hours * 3600:
                        refresher.start(force=True)
                        await asyncio.sleep(hours * 3600)
                    else:
                        await asyncio.sleep(hours * 3600 - age)
            task = asyncio.create_task(loop())
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Smart Basket Namibia", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json")
    local = local_mode()
    if local:  # desktop app: only answer requests addressed to this computer (blocks DNS rebinding)
        from starlette.middleware.trustedhost import TrustedHostMiddleware
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
    app.state.db_file = db_file
    app.state.refresher = refresher
    baskets_cache: dict = {}

    def current_user(request: Request, conn: Conn):
        return auth.user_for_token(conn, request.cookies.get(COOKIE))

    def require_user(user=Depends(current_user)):
        if user is None:
            raise HTTPException(401, "Please sign in first.")
        return user

    def require_admin(user=Depends(require_user)):
        if not user["is_admin"]:
            raise HTTPException(403, "Admins only.")
        return user

    def set_cookie(request: Request, response: Response, token: str):
        secure = request.url.scheme == "https" or os.environ.get("NAMSHOP_SECURE_COOKIES") == "1"
        response.set_cookie(COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True,
                            samesite="lax", secure=secure, path="/")

    def store_list(raw: str | None) -> list[str] | None:
        return [s for s in (raw or "").split(",") if s] or None

    # ---------------- meta & auth
    @app.get("/api/meta")
    def meta(conn: Conn, user=Depends(current_user)):
        sample.ensure_sample(conn)  # rotates the sample specials weekly; no-op otherwise
        counts = {r["source"]: r["n"] for r in conn.execute(
            "SELECT CASE WHEN source LIKE 'feed:%' THEN 'feed' WHEN source LIKE 'import%' THEN 'import' "
            "ELSE source END AS source, COUNT(*) AS n FROM prices GROUP BY 1")}
        special_counts: dict[str, int] = {}
        for x in deals.specials(conn, limit=100_000)["results"]:
            special_counts[x["store_id"]] = special_counts.get(x["store_id"], 0) + 1
        return {"stores": db.stores(conn), "categories": db.categories(conn), "today": db.today().isoformat(),
                "special_counts": special_counts, "claude": leaflets.claude_configured(),
                "last_refresh": json.loads(db.get_setting(conn, "last_refresh", "{}") or "{}"),
                "refreshing": refresher.status()["running"],
                "logo_version": zlib.crc32((db.get_setting(conn, "logo_version", "") or "").encode()),
                "sample_data": sample.enabled(conn) and counts.get("sample", 0) > 0, "price_counts": counts,
                "user": auth.public_user(user), "version": __version__, "local": local}

    @app.post("/api/auth/register")
    def register(body: RegisterIn, request: Request, response: Response, conn: Conn):
        try:
            user = auth.register(conn, body.name, body.email, body.password, body.town)
        except auth.AuthError as e:
            raise HTTPException(400, str(e))
        if local and conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1:
            auth.make_admin(conn, user["email"])   # the desktop app's owner manages it
            user["is_admin"] = True
        set_cookie(request, response, auth.new_session(conn, user["id"]))
        return user

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request, response: Response, conn: Conn):
        try:
            user = auth.login(conn, body.email, body.password)
        except auth.AuthError as e:
            raise HTTPException(400, str(e))
        set_cookie(request, response, auth.new_session(conn, user["id"]))
        return user

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, conn: Conn):
        auth.end_session(conn, request.cookies.get(COOKIE))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @app.get("/api/me")
    def me(user=Depends(current_user)):
        return auth.public_user(user)

    @app.patch("/api/me")
    def update_me(body: ProfileIn, conn: Conn, user=Depends(require_user)):
        known = {s["id"] for s in db.stores(conn)}
        if body.name is not None:
            if not body.name.strip():
                raise HTTPException(400, "Name can't be empty.")
            conn.execute("UPDATE users SET name = ? WHERE id = ?", (body.name.strip(), user["id"]))
        if body.town is not None:
            conn.execute("UPDATE users SET town = ? WHERE id = ?", (body.town.strip(), user["id"]))
        if body.stores is not None:
            conn.execute("UPDATE users SET stores = ? WHERE id = ?",
                         (json.dumps([s for s in body.stores if s in known]), user["id"]))
        conn.commit()
        return auth.public_user(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())

    @app.post("/api/me/password")
    def change_password(body: PasswordIn, conn: Conn, user=Depends(require_user)):
        try:
            auth.change_password(conn, user["id"], body.old, body.new)
        except auth.AuthError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.delete("/api/me")
    def delete_me(request: Request, response: Response, conn: Conn, user=Depends(require_user)):
        conn.execute("DELETE FROM users WHERE id = ?", (user["id"],))
        conn.commit()
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    # ---------------- deals & search
    @app.get("/api/specials")
    def get_specials(conn: Conn, q: str = "", stores: str | None = None, category: str = "",
                     sort: str = "percent", limit: int = Query(60, ge=1, le=500), offset: int = Query(0, ge=0)):
        return deals.specials(conn, q[:100], store_list(stores), category, sort, limit, offset)

    @app.get("/api/search")
    def search(conn: Conn, q: str = Query("", max_length=100), stores: str | None = None,
               limit: int = Query(20, ge=1, le=50)):
        return {"results": deals.search(conn, q, store_list(stores), limit) if q.strip() else []}

    @app.get("/api/items/{item_id}")
    def item(item_id: str, conn: Conn, stores: str | None = None):
        d = deals.item_detail(conn, item_id, store_list(stores))
        if d is None:
            raise HTTPException(404, "No such item.")
        return d

    @app.post("/api/parse-list")
    def parse_list(body: ParseIn, conn: Conn):
        return {"lines": deals.parse_list(conn, body.text)[:100]}

    @app.post("/api/cart/optimize")
    def optimize(body: OptimizeIn, conn: Conn):
        lines = [ln.model_dump() for ln in body.lines if ln.item_id or ln.product_id]
        if len({ln["key"] for ln in lines}) != len(lines):
            raise HTTPException(400, "Duplicate line keys.")
        opts = deals.cart_options(conn, lines, body.stores)
        names = {s["id"]: s["name"] for s in db.stores(conn) if not body.stores or s["id"] in body.stores}
        return optimizer.optimize(opts["info"], opts["options"],
                                  [optimizer.Line(ln["key"], ln["qty"], ln["priority"]) for ln in lines],
                                  names, max_stores=body.max_stores, trip_cost=body.trip_cost, budget=body.budget)

    # ---------------- pamphlets & the Refresh button
    @app.post("/api/refresh")
    def refresh(body: RefreshIn, user=Depends(current_user)):
        """Anyone can ask for the latest pamphlets; repeat requests within a few minutes just return progress."""
        return refresher.start(force=bool(body.force and user and user["is_admin"]))

    @app.get("/api/refresh/status")
    def refresh_status():
        return refresher.status()

    @app.get("/api/leaflets")
    def get_leaflets(conn: Conn):
        return {"leaflets": leaflets.list_leaflets(conn), "claude": leaflets.claude_configured(),
                "sources": {k: [s["url"] for s in v] for k, v in leaflets.sources().items()}}

    @app.get("/leaflets/{store_id}/{name}")
    def leaflet_file(store_id: str, name: str):
        path = leaflets.leaflet_path(store_id, name)
        if path is None:
            raise HTTPException(404, "No such pamphlet.")
        kind = path.suffix.lower()
        mime = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
                ".gif": "image/gif"}.get(kind, "application/octet-stream")
        return FileResponse(path, media_type=mime, headers={"Cache-Control": "public, max-age=86400",
                                                            "X-Content-Type-Options": "nosniff"})

    @app.get("/api/baskets")
    def baskets(conn: Conn):
        """One-tap baskets with what they cost today."""
        version = tuple(conn.execute("SELECT COUNT(*), MAX(updated_at) FROM prices").fetchone()) + (db.today(),)
        if baskets_cache.get("v") == version:
            return baskets_cache["data"]
        names = {s["id"]: s["name"] for s in db.stores(conn)}
        out = []
        for b in json.loads((BUNDLED_DATA / "baskets.json").read_text(encoding="utf-8")):
            lines = [{"key": str(i), "item_id": it, "qty": q} for i, (it, q) in enumerate(b["items"])
                     if conn.execute("SELECT 1 FROM items WHERE id = ?", (it,)).fetchone()]
            opts = deals.cart_options(conn, lines)
            res = optimizer.optimize(opts["info"], opts["options"],
                                     [optimizer.Line(ln["key"], ln["qty"]) for ln in lines], names, max_stores=2)
            out.append({**{k: b[k] for k in ("id", "emoji", "name", "blurb")},
                        "lines": [{"item_id": ln["item_id"], "qty": ln["qty"], "name": opts["info"][ln["key"]]["name"],
                                   "size": opts["info"][ln["key"]]["size"]} for ln in lines],
                        "total": res.get("total"), "stores": [s["store_id"] for s in res.get("stores", [])],
                        "best_single": res.get("best_single"), "count": sum(ln["qty"] for ln in lines)})
        data = {"baskets": out}
        baskets_cache.update(v=version, data=data)
        return data

    # ---------------- saved lists
    def _list_out(r):
        return {"id": r["id"], "name": r["name"], "data": json.loads(r["data"]), "updated_at": r["updated_at"]}

    @app.get("/api/lists")
    def lists(conn: Conn, user=Depends(require_user)):
        rows = conn.execute("SELECT * FROM lists WHERE user_id = ? ORDER BY updated_at DESC", (user["id"],))
        return {"lists": [_list_out(r) for r in rows]}

    @app.post("/api/lists")
    def create_list(body: ListIn, conn: Conn, user=Depends(require_user)):
        data = json.dumps(body.data)
        if len(data) > 60_000:
            raise HTTPException(400, "That list is too big.")
        if conn.execute("SELECT COUNT(*) FROM lists WHERE user_id = ?", (user["id"],)).fetchone()[0] >= 100:
            raise HTTPException(400, "You can keep up to 100 lists. Delete some first.")
        ts = db.stamp()
        cur = conn.execute("INSERT INTO lists(user_id, name, data, created_at, updated_at) VALUES(?,?,?,?,?)",
                           (user["id"], body.name.strip(), data, ts, ts))
        conn.commit()
        return _list_out(conn.execute("SELECT * FROM lists WHERE id = ?", (cur.lastrowid,)).fetchone())

    @app.put("/api/lists/{list_id}")
    def update_list(list_id: int, body: ListIn, conn: Conn, user=Depends(require_user)):
        data = json.dumps(body.data)
        if len(data) > 60_000:
            raise HTTPException(400, "That list is too big.")
        cur = conn.execute("UPDATE lists SET name = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                           (body.name.strip(), data, db.stamp(), list_id, user["id"]))
        conn.commit()
        if not cur.rowcount:
            raise HTTPException(404, "No such list.")
        return _list_out(conn.execute("SELECT * FROM lists WHERE id = ?", (list_id,)).fetchone())

    @app.delete("/api/lists/{list_id}")
    def delete_list(list_id: int, conn: Conn, user=Depends(require_user)):
        conn.execute("DELETE FROM lists WHERE id = ? AND user_id = ?", (list_id, user["id"]))
        conn.commit()
        return {"ok": True}

    # ---------------- community specials
    @app.post("/api/reports")
    def report(body: ReportIn, conn: Conn, user=Depends(require_user)):
        try:
            pid = importer.report_special(conn, user["id"], body.store_id, body.special_price,
                                          product_id_=body.product_id, item_id=body.item_id, brand=body.brand,
                                          price=body.price, label=body.label, valid_until=body.valid_until,
                                          branch=body.branch)
        except importer.ImportProblem as e:
            raise HTTPException(400, str(e))
        return {"ok": True, "product_id": pid}

    @app.get("/api/reports/recent")
    def recent_reports(conn: Conn, limit: int = Query(30, ge=1, le=100)):
        rows = conn.execute(
            "SELECT r.*, u.name AS reporter, s.name AS store_name, p.brand, i.name AS item_name, i.size "
            "FROM reports r LEFT JOIN users u ON u.id = r.user_id JOIN stores s ON s.id = r.store_id "
            "JOIN products p ON p.id = r.product_id JOIN items i ON i.id = p.item_id "
            "ORDER BY r.id DESC LIMIT ?", (limit,))
        return {"reports": [{
            "id": r["id"], "store_id": r["store_id"], "store_name": r["store_name"], "brand": r["brand"],
            "name": r["item_name"], "size": r["size"], "price": r["price"], "special_price": r["special_price"],
            "label": r["special_label"], "valid_until": r["valid_until"], "branch": r["branch"],
            "reporter": (r["reporter"] or "A shopper").split(" ")[0], "created_at": r["created_at"]}
            for r in rows]}

    # ---------------- admin
    @app.get("/api/admin/summary")
    def admin_summary(conn: Conn, user=Depends(require_admin)):
        return {"price_rows": [dict(r) for r in conn.execute(
                    "SELECT source, COUNT(*) AS n, MAX(updated_at) AS latest FROM prices GROUP BY source "
                    "ORDER BY n DESC")],
                "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
                "feeds": importer.feed_config(), "feeds_status": importer.feeds_status(conn),
                "sample_enabled": sample.enabled(conn)}

    @app.post("/api/admin/import")
    def admin_import(body: ImportIn, conn: Conn, user=Depends(require_admin)):
        return importer.import_text(conn, body.text, source="import", fmt=body.format, default_store=body.store)

    @app.post("/api/admin/refresh")
    def admin_refresh(conn: Conn, user=Depends(require_admin)):
        return {"results": importer.refresh_feeds(conn)}

    @app.post("/api/admin/claude-key")
    def admin_claude_key(body: KeyIn, user=Depends(current_user)):
        # On the desktop app whoever sits at this computer may connect Claude; on a server, admins only.
        if not local and not (user and user["is_admin"]):
            raise HTTPException(401 if user is None else 403, "Admins only.")
        leaflets.save_api_key(body.key)
        return {"claude": leaflets.claude_configured()}

    @app.post("/api/admin/sample")
    def admin_sample(body: SampleIn, conn: Conn, user=Depends(require_admin)):
        sample.set_enabled(conn, body.enabled)
        return {"sample_enabled": sample.enabled(conn)}

    @app.delete("/api/admin/prices/{price_id}")
    def admin_delete_price(price_id: int, conn: Conn, user=Depends(require_admin)):
        conn.execute("DELETE FROM prices WHERE id = ?", (price_id,))
        conn.commit()
        return {"ok": True}

    # ---------------- logos & pages
    @app.get("/logos/{store_id}.svg")
    def logo(store_id: str, conn: Conn):
        found = logos.logo_file(store_id)
        if found:
            return FileResponse(found[0], media_type=found[1], headers={
                "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:"})
        row = conn.execute("SELECT name, logo FROM stores WHERE id = ?", (store_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such shop.")
        return Response(logos.badge_svg(row["name"], json.loads(row["logo"])), media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=3600"})

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", response_class=HTMLResponse)
    def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @app.get("/healthz")
    def health():
        return {"ok": True, "app": "smart-basket", "version": __version__}

    return app


def local_mode() -> bool:
    """True for the desktop app: one person, server bound to 127.0.0.1 only."""
    return os.environ.get("NAMSHOP_LOCAL") == "1"


def _ts(iso: str) -> float:
    from datetime import datetime
    try:
        return datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return 0.0
