import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "laya"))

MODEL = "convaiinnovations/laya-multilingual"


@pytest.fixture(scope="session")
def agent():
    import laya

    return laya.load(MODEL, device="cpu", revision=laya.PINNED_REVISIONS.get(MODEL))
