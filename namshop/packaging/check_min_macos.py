"""Fail if any binary inside a macOS .app needs a newer macOS than the app says it supports.

    python namshop/packaging/check_min_macos.py "dist/Smart Basket Namibia.app"

Reads LSMinimumSystemVersion from the app's Info.plist, then every Mach-O file's minimum macOS
(LC_BUILD_VERSION / LC_VERSION_MIN_MACOSX, every architecture slice). A dependency wheel built
for a newer macOS (numpy's macOS 14 wheels, say) would otherwise ship and crash on older Macs.
Pure Python, so it also runs (and is tested) off the Mac.
"""
from __future__ import annotations

import plistlib
import struct
import sys
from pathlib import Path

LC_VERSION_MIN_MACOSX = 0x24
LC_BUILD_VERSION = 0x32
PLATFORM_MACOS = 1
MH_MAGIC, MH_MAGIC_64 = 0xFEEDFACE, 0xFEEDFACF
FAT_MAGIC, FAT_MAGIC_64 = 0xCAFEBABE, 0xCAFEBABF


def _version(packed: int) -> tuple[int, int, int]:
    return packed >> 16, (packed >> 8) & 0xFF, packed & 0xFF


def min_versions(data: bytes) -> list[tuple[int, int, int]]:
    """Minimum macOS version declared by each architecture slice of a Mach-O file ([] if not Mach-O)."""
    if len(data) < 32:
        return []
    big = struct.unpack(">I", data[:4])[0]
    if big in (FAT_MAGIC, FAT_MAGIC_64):
        count = struct.unpack(">I", data[4:8])[0]
        if count > 32:          # Java .class files also start with 0xCAFEBABE
            return []
        out = []
        for i in range(count):
            if big == FAT_MAGIC:
                _, _, offset, size, _ = struct.unpack(">iiIII", data[8 + i * 20: 28 + i * 20])
            else:
                _, _, offset, size, _, _ = struct.unpack(">iiQQII", data[8 + i * 32: 40 + i * 32])
            out += min_versions(data[offset: offset + size])
        return out
    little = struct.unpack("<I", data[:4])[0]
    if little not in (MH_MAGIC, MH_MAGIC_64):
        return []
    ncmds = struct.unpack("<I", data[16:20])[0]
    offset = 32 if little == MH_MAGIC_64 else 28
    out = []
    for _ in range(ncmds):
        if offset + 8 > len(data):
            break
        cmd, size = struct.unpack("<II", data[offset: offset + 8])
        if cmd == LC_BUILD_VERSION:
            platform, minos = struct.unpack("<II", data[offset + 8: offset + 16])
            if platform == PLATFORM_MACOS:
                out.append(_version(minos))
        elif cmd == LC_VERSION_MIN_MACOSX:
            out.append(_version(struct.unpack("<I", data[offset + 8: offset + 12])[0]))
        if size < 8:
            break
        offset += size
    return out


def parse_version(text: str) -> tuple[int, int, int]:
    parts = [int(p) for p in text.split(".")[:3]]
    return tuple(parts + [0] * (3 - len(parts)))


def too_new(app: Path, limit: tuple[int, int, int] | None = None) -> list[tuple[str, str]]:
    """[(file, version)] for binaries that need a newer macOS than ``limit`` (default: the app's plist)."""
    if limit is None:
        with open(app / "Contents" / "Info.plist", "rb") as f:
            limit = parse_version(plistlib.load(f)["LSMinimumSystemVersion"])
    bad = []
    for path in sorted(p for p in app.rglob("*") if p.is_file() and not p.is_symlink()):
        with open(path, "rb") as f:
            head = f.read(4)
        if len(head) < 4 or struct.unpack(">I", head)[0] not in (FAT_MAGIC, FAT_MAGIC_64, 0xCEFAEDFE, 0xCFFAEDFE):
            continue
        for v in min_versions(path.read_bytes()):
            if v > limit:
                bad.append((str(path.relative_to(app)), ".".join(map(str, v))))
    return bad


def main(argv: list[str]) -> int:
    app = Path(argv[1])
    limit = parse_version(argv[2]) if len(argv) > 2 else None
    bad = too_new(app, limit)
    for name, version in bad:
        print(f"needs macOS {version}: {name}")
    if bad:
        print(f"{len(bad)} binaries need a newer macOS than the app supports.")
        return 1
    print("All binaries run on the app's minimum macOS.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
