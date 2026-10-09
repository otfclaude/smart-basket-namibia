"""Build the Smart Basket Namibia desktop app with PyInstaller.

    pip install -r namshop/requirements.txt -r namshop/packaging/requirements-build.txt
    python namshop/packaging/build_app.py

Output: ``dist/Smart Basket Namibia.app`` on macOS (``dist/Smart Basket Namibia/`` elsewhere).
The app is built for the architecture of the Python running this script, so an x86_64 Python
(e.g. under Rosetta) produces an Intel build. CI: .github/workflows/namshop-mac.yml.
"""
from __future__ import annotations

import importlib.util
import os
import plistlib
import re
import sys
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "namshop"
APP = "Smart Basket Namibia"
BUNDLE_ID = "na.smartbasket.desktop"


def version() -> str:
    m = re.search(r'__version__ = "([^"]+)"', (PKG / "__init__.py").read_text(encoding="utf-8"))
    return m.group(1) if m else "0.0.0"


def main():
    sep = os.pathsep
    args = [
        str(PKG / "desktop.py"), "--name", APP, "--noconfirm", "--onedir", "--clean",
        "--paths", str(ROOT),
        "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build" / "pyinstaller"),
        "--specpath", str(ROOT / "build"),
        "--add-data", f"{PKG / 'static'}{sep}namshop/static",
        "--add-data", f"{PKG / 'data'}{sep}namshop/data",
        "--collect-submodules", "namshop", "--exclude-module", "namshop.tests",
        "--collect-submodules", "uvicorn",          # uvicorn picks its loop/protocol modules at runtime
        "--collect-all", "highspy",                 # the optimiser's MIP solver (native library)
        "--collect-all", "pulp",
        "--collect-submodules", "anthropic",        # Claude SDK, used to read pamphlets
        "--collect-data", "certifi",                # CA certificates for HTTPS from a GUI app
        "--exclude-module", "tkinter", "--exclude-module", "pytest", "--exclude-module", "_pytest",
    ]
    if sys.platform in ("darwin", "win32"):
        args += ["--windowed"]
    if sys.platform == "darwin":
        args += ["--icon", str(PKG / "packaging" / "icon.icns"), "--osx-bundle-identifier", BUNDLE_ID]
    if importlib.util.find_spec("webview"):
        args += ["--collect-all", "webview"]
    PyInstaller.__main__.run(args)

    if sys.platform == "darwin":
        plist_path = ROOT / "dist" / f"{APP}.app" / "Contents" / "Info.plist"
        with open(plist_path, "rb") as f:
            info = plistlib.load(f)
        info.update({
            "CFBundleDisplayName": APP,
            "CFBundleShortVersionString": version(),
            "CFBundleVersion": version(),
            "LSApplicationCategoryType": "public.app-category.shopping",
            "LSMinimumSystemVersion": "11.0",
            "NSHighResolutionCapable": True,
            "NSRequiresAquaSystemAppearance": False,      # follow the system's dark mode
            "NSHumanReadableCopyright": "Smart Basket Namibia. Shop names and logos belong to their owners.",
        })
        with open(plist_path, "wb") as f:
            plistlib.dump(info, f)
        print(f"Built dist/{APP}.app (version {version()})")


if __name__ == "__main__":
    main()
