import numpy as np

from brainbench.session import PacketStats, Session

from .conftest import wait_for


def test_synthetic_session_streams_the_chosen_channels(synthetic):
    d = synthetic.describe()
    assert len(synthetic.layout.eeg) == 4 and len(synthetic.channels) == 4
    assert synthetic.layout.sampling_rate == 250
    got = []
    synthetic.listeners.append(lambda chunk: got.append(chunk.shape))
    synthetic.start_stream()
    assert wait_for(lambda: synthetic.recent(10).shape[1] >= 250)
    synthetic.stop_stream()
    assert got and all(rows == synthetic.layout.num_rows for rows, _ in got)
    assert d["label"] and not synthetic.describe()["streaming"]


def test_markers_land_in_the_marker_row(synthetic):
    synthetic.start_stream()
    wait_for(lambda: synthetic.recent(1).shape[1] > 10)
    synthetic.insert_marker(3)
    assert wait_for(lambda: 3 in synthetic.recent(5)[synthetic.layout.marker])
    synthetic.stop_stream()


def test_packet_stats_count_gaps_but_not_wraps():
    p = PacketStats()
    p.update(np.array([0, 1, 2, 3, 255 - 1, 255, 0, 1]))  # 4..253 missing, then a wrap
    assert p.lost == 250 and p.received == 8
    q = PacketStats(step=2)  # Daisy: every second value
    q.update(np.array([0, 2, 4, 8, 10]))
    assert q.lost == 1


def test_unknown_source_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        Session("not-a-board")
