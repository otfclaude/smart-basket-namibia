"""Smart Basket Namibia: compare specials across Namibian supermarkets and build the
cheapest shopping cart, or the best cart that fits a budget."""
from __future__ import annotations

import os
from pathlib import Path

__version__ = "1.1.0"

PKG_DIR = Path(__file__).resolve().parent
STATIC_DIR = PKG_DIR / "static"
BUNDLED_DATA = PKG_DIR / "data"


def data_dir() -> Path:
    """Writable folder for the database, uploaded logos and feed config."""
    d = Path(os.environ.get("NAMSHOP_DATA") or Path.home() / ".namshop")
    d.mkdir(parents=True, exist_ok=True)
    return d
