"""Desktop app: runs Smart Basket Namibia on this computer and shows it in its own window.

Packaged for the Mac by ``namshop/packaging/build_app.py`` (see .github/workflows/namshop-mac.yml).
From source: ``python -m namshop.desktop``.

The web server runs in a background thread on a fixed local port, so the window's saved cart and
sign-in (kept by WebKit per address) survive restarts. Only this computer can reach it.

Flags:
  --selftest   start the server, exercise the main features, write the result to
               NAMSHOP_SELFTEST_OUT (default: <app data>/selftest.txt) and exit 0/1. Used by CI.
Environment:
  NAMSHOP_NO_WINDOW=1  serve without opening a window and print the address (CI / headless).
"""
from __future__ import annotations

import faulthandler
import json
import logging
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "Smart Basket Namibia"
# The window's saved cart and sign-in belong to its exact address, so the port must stay the same
# from launch to launch. Each macOS user gets their own port; the one in use is remembered.
BASE_PORT = 47826 + (os.getuid() % 500 if hasattr(os, "getuid") else 0)


def app_data_dir() -> Path:
    if sys.platform == "darwin":
        d = Path.home() / "Library" / "Application Support" / APP_NAME
    elif sys.platform == "win32":
        d = Path(os.environ.get("APPDATA") or Path.home()) / APP_NAME
    else:
        d = Path.home() / ".namshop"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _setup(data: Path):
    os.environ.setdefault("NAMSHOP_DATA", str(data))
    os.environ["NAMSHOP_LOCAL"] = "1"            # single-person app: see server.py "local mode"
    os.environ["NAMSHOP_INSTANCE"] = _instance_id(data)
    log = open(data / "app.log", "a", buffering=1, encoding="utf-8")
    if getattr(sys, "frozen", False) and not os.environ.get("NAMSHOP_NO_WINDOW"):
        sys.stdout = sys.stderr = log             # a Finder launch has nowhere else to write
    elif sys.stdout is None or sys.stderr is None:
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log
    faulthandler.enable(log)
    logging.basicConfig(stream=log, level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    sys.excepthook = lambda *exc: logging.error("uncaught error", exc_info=exc)
    threading.excepthook = lambda a: logging.error("error in thread %s", a.thread, exc_info=(a.exc_type, a.exc_value, a.exc_traceback))
    # GUI apps on macOS don't inherit the shell's proxy/CA settings; certifi gives Python a CA bundle
    try:
        import certifi
        os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    except ImportError:
        pass


def _instance_id(data: Path) -> str:
    """A random id for this user's app, so we only ever reuse our own running server."""
    path = data / "instance"
    try:
        return path.read_text().strip() or _new_instance(path)
    except OSError:
        return _new_instance(path)


def _new_instance(path: Path) -> str:
    token = secrets.token_hex(12)
    try:
        path.write_text(token)
    except OSError:
        pass
    return token


def _port_free(port: int) -> bool:
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # same as uvicorn: ignore TIME_WAIT
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _choose_port(data: Path) -> tuple[int, bool]:
    """(port, reuse): the remembered port if possible, else this user's usual one, else the next free.

    reuse=True means our own server is already running there (e.g. started from the command line).
    """
    saved = None
    try:
        saved = int((data / "port").read_text().strip())
    except (OSError, ValueError):
        pass
    candidates = ([saved] if saved else []) + [BASE_PORT + i for i in range(30)]
    for port in dict.fromkeys(candidates):
        if _is_ours(port):
            return port, True
        if _port_free(port):
            try:
                (data / "port").write_text(str(port))
            except OSError:
                pass
            return port, False
    return _free_port(), False


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _get(url: str, timeout: float = 5):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def _is_ours(port: int) -> bool:
    try:
        status, _, body = _get(f"http://127.0.0.1:{port}/healthz", 2)
        info = json.loads(body)
        return status == 200 and info.get("app") == "smart-basket" and \
            info.get("instance") == os.environ.get("NAMSHOP_INSTANCE")
    except Exception:
        return False


def start_server(port: int, refresh_hours: float | None = None):
    """Start the API + web app in a background thread. Returns (server, thread)."""
    import uvicorn

    from namshop.server import create_app
    config = uvicorn.Config(create_app(refresh_hours=refresh_hours), host="127.0.0.1", port=port,
                            log_level="warning", log_config=None, access_log=False, lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="smart-basket-server", daemon=True)
    thread.start()
    deadline = time.time() + 60
    while not server.started:
        if not thread.is_alive() or time.time() > deadline:
            raise RuntimeError("The Smart Basket server didn't start. See app.log in the app's data folder.")
        time.sleep(0.05)
    return server, thread


def selftest() -> int:
    """Exercise the packaged app end to end, without a window and without the internet."""
    import tempfile
    out = Path(os.environ.get("NAMSHOP_SELFTEST_OUT") or app_data_dir() / "selftest.txt")
    os.environ["NAMSHOP_DATA"] = tempfile.mkdtemp(prefix="smart-basket-selftest-")
    os.environ["NAMSHOP_PBKDF2_ITERATIONS"] = "1000"
    lines, server = [], None
    try:
        port = _free_port()
        server, _ = start_server(port, refresh_hours=0)
        base = f"http://127.0.0.1:{port}"

        def check(path, want_type="", contains=b""):
            status, ctype, body = _get(base + path, 20)
            assert status == 200, f"{path}: HTTP {status}"
            assert want_type in ctype, f"{path}: content type {ctype}"
            assert contains in body, f"{path}: missing {contains!r}"
            lines.append(f"ok {path} ({len(body)} bytes)")
            return body

        assert json.loads(check("/healthz", "json"))["app"] == "smart-basket"
        check("/", "html", b"Smart Basket")
        check("/static/app.js", "javascript", b"renderDeals")
        check("/static/app.css", "css", b".deal")
        check("/static/vendor/motion-13.4.0.min.js", "javascript", b"Motion")
        # the pamphlet reader imports pdf.js as ES modules, which only run when served as JavaScript
        check("/static/vendor/pdfjs-6.3.289/pdf.min.mjs", "javascript", b"getDocument")
        check("/static/vendor/pdfjs-6.3.289/pdf.worker.min.mjs", "javascript", b"WorkerMessageHandler")
        check("/logos/shoprite.svg", "svg", b"<svg")
        meta = json.loads(check("/api/meta", "json"))
        assert len(meta["stores"]) >= 10 and meta["local"] is True, "meta"
        assert json.loads(check("/api/specials?limit=3", "json"))["total"] > 0, "no specials"
        baskets = json.loads(check("/api/baskets", "json"))["baskets"]
        assert baskets and all(b["total"] for b in baskets), "baskets not priced (optimiser)"
        req = urllib.request.Request(base + "/api/cart/optimize", method="POST", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"lines": [{"key": "a", "item_id": "maize-meal-10kg", "qty": 2},
                                                                {"key": "b", "item_id": "sunflower-oil-2l", "qty": 1}],
                                                      "budget": 150}).encode())
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read())
        assert res["status"] in ("ok", "partial") and res["total"] <= 150, f"optimiser: {res.get('status')}"
        lines.append(f"ok budget cart N${res['total']}")
        import importlib
        anthropic = importlib.import_module("anthropic")   # pamphlet reading
        importlib.import_module("highspy")                  # cart optimiser's solver
        from namshop import leaflets
        lines.append(f"ok anthropic {anthropic.__version__}, model {leaflets.MODEL}")
        if sys.platform in ("darwin", "win32"):
            importlib.import_module("webview")              # the native window
            lines.append("ok webview")
        out.write_text("SELFTEST OK\n" + "\n".join(lines) + "\n", encoding="utf-8")
        print("SELFTEST OK", flush=True)
        return 0
    except Exception:
        out.write_text("SELFTEST FAILED\n" + "\n".join(lines) + "\n" + traceback.format_exc(), encoding="utf-8")
        print("SELFTEST FAILED", traceback.format_exc(), sep="\n", flush=True)
        return 1
    finally:
        if server is not None:
            server.should_exit = True


def _alert(title: str, message: str):
    """Tell the person something went wrong, even though the window never opened."""
    try:
        if sys.platform == "darwin":
            script = f'display alert {json.dumps(title)} message {json.dumps(message)} as critical'
            subprocess.run(["osascript", "-e", script], timeout=120, check=False)
        else:
            print(f"{title}: {message}", file=sys.stderr)
    except Exception:
        pass


def main():
    data = app_data_dir()
    _setup(data)
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    try:
        run(data)
    except Exception:
        logging.exception("Smart Basket Namibia couldn't start")
        _alert(f"{APP_NAME} couldn't start",
               f"The details are in {data / 'app.log'}. Try opening the app again; if it keeps happening, "
               "send that file to whoever gave you the app.")
        sys.exit(1)


def run(data: Path):
    port, reuse = _choose_port(data)
    server = thread = None
    if not reuse:
        server, thread = start_server(port)
    url = f"http://127.0.0.1:{port}/"
    logging.info("serving %s (data: %s)", url, os.environ["NAMSHOP_DATA"])

    if os.environ.get("NAMSHOP_NO_WINDOW"):
        print(url, flush=True)
        try:
            while thread is not None and thread.is_alive():
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        return
    try:
        import webview
    except ImportError:  # e.g. Linux without a GUI toolkit: use the normal browser
        webbrowser.open(url)
        print(f"{APP_NAME} is running at {url}. Press Ctrl+C to quit.", flush=True)
        try:
            while thread is not None and thread.is_alive():
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        return
    webview.create_window(APP_NAME, url, width=1320, height=880, min_size=(380, 560),
                          background_color="#F6F6F4", text_select=True)
    # private_mode=False keeps the cart and sign-in between launches. On macOS WebKit keeps them in
    # ~/Library/WebKit/<bundle id> (storage_path is used by the other platforms' backends).
    webview.start(private_mode=False, storage_path=str(data / "webview"))
    # Window closed: stop serving and quit now, even if a pamphlet refresh is still downloading
    # (its worker threads would otherwise keep the process alive until they finish).
    if server is not None:
        server.should_exit = True
        thread.join(5)
    logging.shutdown()
    os._exit(0)


if __name__ == "__main__":
    main()
