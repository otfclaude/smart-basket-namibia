"""Pamphlet diagnostics, run by .github/workflows/namshop-pamphlets.yml (not part of the app).

    python namshop/packaging/diagnose_pamphlets.py report        # what each source offers, and what was stored
    python namshop/packaging/diagnose_pamphlets.py seed DATA_DIR # a database with one known 4-page PDF pamphlet

``report`` reads NAMSHOP_DATA like the app does. It never sends anything to Claude.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


def pdf_pages(body: bytes) -> int:
    try:
        import io

        from pypdf import PdfReader
        return len(PdfReader(io.BytesIO(body)).pages)
    except Exception:  # pypdf missing or the file is unusual: count page objects instead
        return len(re.findall(rb"/Type\s*/Page(?!s)", body))


def report():
    from namshop import db, leaflets, net
    print("== What each source page offers (found before download)")
    for store, srcs in leaflets.sources().items():
        for src in srcs:
            try:
                found = leaflets.find_pamphlets(store, src)
            except net.FetchError as e:
                print(f"{store:14} unreachable  {src['url']}  ({e})")
                continue
            if not found:
                print(f"{store:14} nothing      {src['url']}")
            for p in found:
                print(f"{store:14} {p.kind:9} {len(p.urls):2} url(s)  {src['url']}")
                for u in p.urls[:30]:
                    print(f"{'':27}- {u}")
    print("\n== Stored pamphlets (what the app shows)")
    conn = db.connect()
    for l in leaflets.list_leaflets(conn):
        sizes, pages = [], 0
        for f in l["files"]:
            path = leaflets.leaflet_path(l["store_id"], f.rsplit("/", 1)[1])
            body = path.read_bytes() if path else b""
            sizes.append(f"{len(body) // 1024}KB")
            pages += pdf_pages(body) if l["kind"] == "pdf" else 1
        print(f"{l['store_id']:14} {l['kind']:7} files={len(l['files']):2} pages={pages:3} {' '.join(sizes[:12])}  "
              f"{l['title']!r}  from {l['page_url'] or ''}")


def test_pdf(n: int = 4) -> bytes:
    """A small valid PDF with n numbered pages."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join(f"{4 + 2 * i} 0 R" for i in range(n)), n),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    for i in range(n):
        text = f"BT /F1 64 Tf 120 560 Td (Test page {i + 1}) Tj ET".encode()
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
                    f"/Contents {5 + 2 * i} 0 R >>")
        objs.append(f"<< /Length {len(text)} >>\nstream\n{text.decode()}\nendstream")
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def seed(data_dir: str):
    os.environ["NAMSHOP_DATA"] = data_dir
    from namshop import db, leaflets
    from namshop.server import create_app
    create_app(refresh_hours=0)
    conn = db.connect()
    body = test_pdf(4)
    assert pdf_pages(body) == 4
    p = leaflets.Pamphlet("shoprite", "Test pamphlet", "https://example.invalid/", ["https://example.invalid/t.pdf"], "pdf")
    p.files = [(body, "pdf")]
    sha = hashlib.sha256(body).hexdigest()
    names = leaflets._store_files(p, sha)
    conn.execute("INSERT INTO leaflets(store_id, title, source_url, page_url, kind, files, sha256, fetched_at, status, message, n_specials) "
                 "VALUES(?,?,?,?,?,?,?,?,?,?,0)", ("shoprite", "Test pamphlet", p.urls[0], p.page_url, "pdf", json.dumps(names), sha,
                                                  db.stamp(), "stored", ""))
    conn.commit()
    print("seeded a 4-page PDF pamphlet in", data_dir)


if __name__ == "__main__":
    if sys.argv[1:2] == ["report"]:
        report()
    elif sys.argv[1:2] == ["seed"] and len(sys.argv) == 3:
        seed(sys.argv[2])
    else:
        sys.exit(__doc__)
