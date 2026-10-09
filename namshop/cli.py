"""Command line: ``python -m namshop serve | import FILE | refresh | make-admin EMAIL | sample on|off | stats``."""
from __future__ import annotations

import argparse
import sys
import webbrowser
from pathlib import Path

from . import auth, db, importer, sample


def _conn():
    c = db.connect()
    db.init_db(c)
    return c


def main(argv: list[str] | None = None):
    ap = argparse.ArgumentParser(prog="python -m namshop", description="Smart Basket Namibia")
    sub = ap.add_subparsers(dest="cmd")
    s = sub.add_parser("serve", help="run the web app")
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let phones on your network connect")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--open", action="store_true", help="open the app in your browser")
    i = sub.add_parser("import", help="import prices/specials from a CSV or JSON file")
    i.add_argument("file")
    i.add_argument("--store", help="shop id to use for rows without a 'store' column")
    sub.add_parser("refresh", help="fetch the latest pamphlets, logos and price feeds now")
    a = sub.add_parser("make-admin", help="give an existing account admin rights")
    a.add_argument("email")
    sm = sub.add_parser("sample", help="turn the sample prices on or off")
    sm.add_argument("state", choices=["on", "off"])
    sub.add_parser("stats", help="show what's in the database")
    args = ap.parse_args(argv)

    if args.cmd in (None, "serve"):
        import uvicorn
        from .server import create_app
        host = getattr(args, "host", "127.0.0.1")
        port = getattr(args, "port", 8000)
        url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{port}"
        print(f"Smart Basket Namibia running at {url}  (data: {db.db_path()})")
        if getattr(args, "open", False):
            webbrowser.open(url)
        uvicorn.run(create_app(), host=host, port=port, log_level="warning")
    elif args.cmd == "import":
        text = Path(args.file).read_text(encoding="utf-8-sig")
        res = importer.import_text(_conn(), text, source=f"import:{Path(args.file).name}"[:60],
                                   default_store=args.store)
        print(f"Imported {res['imported']} prices.")
        for e in res["errors"]:
            print("  !", e)
        sys.exit(1 if res["errors"] and not res["imported"] else 0)
    elif args.cmd == "refresh":
        import time
        from . import leaflets
        _conn().close()
        m = leaflets.RefreshManager(str(db.db_path()))
        m.start(force=True)
        while m.status()["running"]:
            time.sleep(1)
        s = m.status()
        for shop in s["shops"].values():
            print(f"{shop['name']:22} {shop['state']:8} {shop['message']}")
        print(s["summary"])
        if not s["claude"]:
            print("Tip: set ANTHROPIC_API_KEY so Claude reads the prices from the pamphlets.")
    elif args.cmd == "make-admin":
        ok = auth.make_admin(_conn(), args.email)
        print("Done." if ok else f"No account with email {args.email}. Register in the app first.")
        sys.exit(0 if ok else 1)
    elif args.cmd == "sample":
        c = _conn()
        sample.set_enabled(c, args.state == "on")
        print(f"Sample prices {args.state}.")
    elif args.cmd == "stats":
        c = _conn()
        sample.ensure_sample(c)
        for r in c.execute("SELECT source, COUNT(*) AS n FROM prices GROUP BY source ORDER BY n DESC"):
            print(f"{r['source']:30} {r['n']:6} prices")
        print(f"{'users':30} {c.execute('SELECT COUNT(*) FROM users').fetchone()[0]:6}")
