import json
import socket
import struct

import numpy as np
from brainflow.board_shim import BoardIds

from brainbench.boards import layout_for
from brainbench.network import MarkerListener, Network, Output

from .conftest import wait_for


def udp_listener():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0)); s.settimeout(2)
    return s, s.getsockname()[1]


def test_udp_sends_openbci_gui_json_lines():
    layout = layout_for(int(BoardIds.CYTON_BOARD))
    sock, port = udp_listener()
    net = Network()
    net.configure([{"protocol": "udp", "type": "timeSeriesRaw", "ip": "127.0.0.1", "port": port}], layout)
    chunk = np.zeros((layout.num_rows, 5)); chunk[layout.eeg[0]] = [1, 2, 3, 4, 5]
    net.raw(chunk, layout)
    msg = sock.recv(65536).decode()
    assert msg.endswith("\r\n")
    obj = json.loads(msg)
    assert obj["type"] == "timeSeriesRaw" and obj["data"][0] == [1, 2, 3, 4, 5] and len(obj["data"]) == 8
    net.derived("bandPower", [[1, 2, 3, 4, 5]] * 8)  # not configured: nothing is sent
    assert net.status()["streams"][0]["sent"] == 1
    net.close()


def test_osc_addresses():
    from pythonosc.osc_message import OscMessage

    sock, port = udp_listener()
    out = Output({"protocol": "osc", "type": "averageBandPower", "ip": "127.0.0.1", "port": port, "address": "/openbci"}, None)
    out.send([0.1, 0.2, 0.3, 0.4, 0.5])
    first = OscMessage(sock.recv(4096))
    assert first.address == "/openbci/average-band-power/0" and abs(first.params[0] - 0.1) < 1e-6
    out.close()


def test_serial_line_format():
    class Port:
        buf = b""
        def write(self, b): self.buf += b
        def close(self): pass
    out = Output.__new__(Output)
    out.protocol, out.type, out.port, out.sent, out.error = "serial", "focus", Port(), 0, ""
    out.send([0.75])
    out.send(np.array([[1.0, 2.0], [3.0, 4.25]]))  # newest sample of each channel
    assert out.port.buf == b"[0.750]\n[2.000,4.250]\n"


def test_unknown_type_is_rejected():
    import pytest

    with pytest.raises(ValueError):
        Output({"protocol": "udp", "type": "nope"}, None)


def test_marker_listener_reads_big_endian_floats():
    got = []
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]; probe.close()
    m = MarkerListener(got.append, port=port)
    assert m.start()
    tx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    tx.sendto(struct.pack(">f", 7.0), ("127.0.0.1", port))
    assert wait_for(lambda: got)
    assert got == [7.0]
    m.stop()
