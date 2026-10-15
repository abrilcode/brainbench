import numpy as np
import pytest
from brainflow.board_shim import BoardIds

from brainbench.boards import layout_for
from brainbench.focus import FocusModel

# The weights of BrainFlow's MINDFULNESS logistic model; the online demo scores focus with them.
W = np.array([-1.40609, 2.597694, -30.964705, 12.04594, 45.773018])


@pytest.fixture(scope="module")
def model():
    m = FocusModel()
    yield m
    m.close()


def test_recovered_weights_match_brainflow(model):
    rng = np.random.default_rng(1)
    for _ in range(20):
        x = rng.dirichlet(np.ones(5))  # relative band powers sum to 1
        expected = 1 / (1 + np.exp(-(W @ x)))
        got = model._model("concentration").predict(x)[0]
        assert got == pytest.approx(expected, abs=1e-4)
        assert model._model("relaxation").predict(x)[0] == pytest.approx(1 - expected, abs=1e-4)


def test_predict_needs_two_seconds(model):
    layout = layout_for(int(BoardIds.SYNTHETIC_BOARD))
    short = np.zeros((layout.num_rows, 100))
    assert model.predict(short, layout)["value"] is None
    rng = np.random.default_rng(0)
    data = np.zeros((layout.num_rows, 2500))
    t = np.arange(2500) / 250
    for row in layout.eeg:
        data[row] = 20 * np.sin(2 * np.pi * 10 * t) + rng.normal(0, 3, 2500)
    r = model.predict(data, layout, "relaxation", channels=[0, 1, 2, 3])
    assert 0 <= r["value"] <= 1 and len(r["bands"]) == 5
    with pytest.raises(ValueError):
        model.predict(data, layout, "happiness")
