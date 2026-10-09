import os
import tempfile

# Fast password hashing and a throwaway data folder for every test run.
os.environ.setdefault("NAMSHOP_PBKDF2_ITERATIONS", "1000")
os.environ["NAMSHOP_DATA"] = tempfile.mkdtemp(prefix="namshop-test-")
os.environ["NAMSHOP_REFRESH_HOURS"] = "0"

import pytest  # noqa: E402

from namshop import db, sample  # noqa: E402


@pytest.fixture
def conn(tmp_path):
    c = db.connect(tmp_path / "t.db")
    db.init_db(c)
    sample.ensure_sample(c)
    yield c
    c.close()


@pytest.fixture
def client(tmp_path):
    from fastapi.testclient import TestClient

    from namshop.server import create_app
    with TestClient(create_app(tmp_path / "api.db", refresh_hours=0)) as c:
        yield c
