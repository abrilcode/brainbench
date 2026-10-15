import time

import pytest
from brainflow.board_shim import BoardShim

BoardShim.disable_board_logger()


def wait_for(cond, timeout=5.0, step=0.05):
    """Polls until cond() is true; returns its last value."""
    end = time.time() + timeout
    while time.time() < end:
        v = cond()
        if v:
            return v
        time.sleep(step)
    return cond()


@pytest.fixture
def synthetic():
    from brainbench.session import Session

    s = Session("synthetic", {"channels": 4})
    s.connect()
    yield s
    s.disconnect()
