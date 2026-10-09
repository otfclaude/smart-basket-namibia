"""The Mac app's launcher (desktop.py) and its packaging check (packaging/check_min_macos.py)."""
import importlib.util
import plistlib
import socket
import struct
from pathlib import Path

from namshop import desktop

_spec = importlib.util.spec_from_file_location(
    "check_min_macos", Path(__file__).resolve().parents[1] / "packaging" / "check_min_macos.py")
check_min_macos = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_min_macos)


# ---------------------------------------------------------------- minimum macOS of bundled binaries

def _ver(major, minor=0, patch=0):
    return major << 16 | minor << 8 | patch


def _macho(*, build=None, min_macosx=None, platform=1):
    """A minimal 64-bit Mach-O header with LC_BUILD_VERSION and/or LC_VERSION_MIN_MACOSX."""
    cmds = b""
    if build:
        cmds += struct.pack("<IIIIII", 0x32, 24, platform, _ver(*build), _ver(15), 0)
    if min_macosx:
        cmds += struct.pack("<IIII", 0x24, 16, _ver(*min_macosx), _ver(15))
    ncmds = bool(build) + bool(min_macosx)
    return struct.pack("<IiiIIIII", 0xFEEDFACF, 0x0100000C, 0, 6, ncmds, len(cmds), 0, 0) + cmds


def _fat(*slices):
    header = struct.pack(">II", 0xCAFEBABE, len(slices))
    offset = 4096
    archs, body = b"", b""
    for s in slices:
        archs += struct.pack(">iiIII", 0x0100000C, 0, offset + len(body), len(s), 12)
        body += s
    return (header + archs).ljust(offset, b"\0") + body


def test_min_versions_of_thin_and_fat_binaries():
    assert check_min_macos.min_versions(_macho(build=(14, 0))) == [(14, 0, 0)]
    assert check_min_macos.min_versions(_macho(min_macosx=(10, 13))) == [(10, 13, 0)]
    assert check_min_macos.min_versions(_macho(build=(11, 3), platform=2)) == []       # an iOS slice
    assert check_min_macos.min_versions(_fat(_macho(build=(11, 0)), _macho(min_macosx=(10, 9)))) == \
        [(11, 0, 0), (10, 9, 0)]
    java_class = struct.pack(">IHH", 0xCAFEBABE, 0, 52) + b"\0" * 40                    # same magic
    assert check_min_macos.min_versions(java_class) == []
    assert check_min_macos.min_versions(b"#!/bin/sh\necho not a binary\n" * 3) == []


def test_too_new_flags_binaries_above_the_apps_minimum(tmp_path):
    app = tmp_path / "Shop.app"
    (app / "Contents" / "Frameworks").mkdir(parents=True)
    with open(app / "Contents" / "Info.plist", "wb") as f:
        plistlib.dump({"LSMinimumSystemVersion": "11.3"}, f)
    (app / "Contents" / "Frameworks" / "ok.so").write_bytes(_macho(build=(11, 0)))
    (app / "Contents" / "Frameworks" / "numpy.so").write_bytes(_fat(_macho(build=(14, 0)), _macho(build=(11, 0))))
    (app / "Contents" / "Frameworks" / "notes.txt").write_text("hello")
    assert check_min_macos.too_new(app) == [("Contents/Frameworks/numpy.so", "14.0.0")]
    assert check_min_macos.too_new(app, (14, 0, 0)) == []
    assert check_min_macos.main(["check", str(app)]) == 1
    assert check_min_macos.main(["check", str(app), "14.0"]) == 0


# ---------------------------------------------------------------- launcher: port and instance

def test_port_is_remembered_and_busy_ports_are_skipped(tmp_path, monkeypatch):
    monkeypatch.setenv("NAMSHOP_INSTANCE", "mine")
    base = desktop._free_port()
    monkeypatch.setattr(desktop, "BASE_PORT", base)
    assert desktop._choose_port(tmp_path) == (base, False)
    assert (tmp_path / "port").read_text() == str(base)
    with socket.socket() as other_app:                 # someone else's program takes the port
        other_app.bind(("127.0.0.1", base))
        port, reuse = desktop._choose_port(tmp_path)
    assert port != base and reuse is False
    assert (tmp_path / "port").read_text() == str(port)    # the window's address stays put from now on


def test_only_our_own_running_server_is_reused(tmp_path, monkeypatch):
    monkeypatch.setenv("NAMSHOP_DATA", str(tmp_path))
    monkeypatch.setenv("NAMSHOP_LOCAL", "1")
    monkeypatch.setenv("NAMSHOP_INSTANCE", "mine")
    port = desktop._free_port()
    server, thread = desktop.start_server(port, refresh_hours=0)
    try:
        assert desktop._is_ours(port)
        (tmp_path / "port").write_text(str(port))
        assert desktop._choose_port(tmp_path) == (port, True)
        monkeypatch.setenv("NAMSHOP_INSTANCE", "another user's app")
        assert not desktop._is_ours(port)
        assert desktop._choose_port(tmp_path)[0] != port
    finally:
        server.should_exit = True
        thread.join(10)


def test_instance_id_is_stable(tmp_path):
    first = desktop._instance_id(tmp_path)
    assert len(first) == 24 and desktop._instance_id(tmp_path) == first
