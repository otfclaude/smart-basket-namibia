#!/bin/bash
# Smart Basket Namibia: run from this folder (macOS). Double-click in Finder.
# The first start installs what it needs (1–3 minutes), then opens the app in your browser.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed. macOS will now offer to install Apple's developer tools (includes Python)."
  echo "Click Install, wait for it to finish, then double-click this file again."
  xcode-select --install 2>/dev/null
  read -r -p "Press Enter to close…"
  exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "Your Python is too old ($(python3 --version)). Install Python 3.12 from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -x .venv-shop/bin/python ]; then
  echo "First start: setting up…"
  python3 -m venv .venv-shop || { read -r -p "Setup failed. Press Enter to close…"; exit 1; }
fi
./.venv-shop/bin/python -m pip install -q --upgrade pip
./.venv-shop/bin/python -m pip install -q -r namshop/requirements.txt || {
  read -r -p "Installing failed (check your internet connection). Press Enter to close…"; exit 1; }

echo "Starting Smart Basket Namibia. Close this window to stop it."
exec ./.venv-shop/bin/python -m namshop serve --open
