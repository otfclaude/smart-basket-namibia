@echo off
REM Smart Basket Namibia: double-click to run from this folder (Windows).
cd /d "%~dp0"
if not exist .venv-shop (
  py -3 -m venv .venv-shop
)
.venv-shop\Scripts\python -m pip install -q -r namshop\requirements.txt
.venv-shop\Scripts\python -m namshop serve --open
