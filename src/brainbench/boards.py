"""The data sources BrainBench can open, and how each maps onto BrainFlow.

Every OpenBCI board is driven through BrainFlow's BoardShim. This module only
describes them: what to ask the user before connecting, which BrainFlow board
id to use, and what the rows of a data chunk mean.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brainflow.board_shim import BoardIds, BoardShim, BrainFlowInputParams


@dataclass(frozen=True)
class Source:
    """One entry in the data-source list of the start screen."""

    key: str
    label: str
    board_id: int
    family: str  # "cyton", "ganglion", "synthetic", "playback", "streaming"
    connection: str  # "serial", "wifi", "ble", "none", "file", "multicast"
    note: str = ""
    fields: tuple[str, ...] = ()  # connection parameters the user fills in


SOURCES: tuple[Source, ...] = (
    Source("cyton", "Cyton", BoardIds.CYTON_BOARD, "cyton", "serial",
           "8 channels at 250 Hz over the USB dongle", ("serial_port",)),
    Source("cyton_daisy", "Cyton + Daisy", BoardIds.CYTON_DAISY_BOARD, "cyton", "serial",
           "16 channels at 125 Hz over the USB dongle", ("serial_port",)),
    Source("cyton_wifi", "Cyton over WiFi Shield", BoardIds.CYTON_WIFI_BOARD, "cyton", "wifi",
           "8 channels, up to 1000 Hz", ("ip_address", "ip_port")),
    Source("cyton_daisy_wifi", "Cyton + Daisy over WiFi Shield", BoardIds.CYTON_DAISY_WIFI_BOARD, "cyton", "wifi",
           "16 channels, up to 1000 Hz", ("ip_address", "ip_port")),
    Source("ganglion", "Ganglion (BLED112 dongle)", BoardIds.GANGLION_BOARD, "ganglion", "serial",
           "4 channels at 200 Hz", ("serial_port", "mac_address")),
    Source("ganglion_native", "Ganglion (Bluetooth)", BoardIds.GANGLION_NATIVE_BOARD, "ganglion", "ble",
           "4 channels at 200 Hz over the computer's own Bluetooth", ("mac_address",)),
    Source("ganglion_wifi", "Ganglion over WiFi Shield", BoardIds.GANGLION_WIFI_BOARD, "ganglion", "wifi",
           "4 channels, up to 1600 Hz", ("ip_address", "ip_port")),
    Source("synthetic", "Synthetic", BoardIds.SYNTHETIC_BOARD, "synthetic", "none",
           "16 simulated channels at 250 Hz, no hardware needed"),
    Source("playback", "File playback", BoardIds.PLAYBACK_FILE_BOARD, "playback", "file",
           "Replay an OpenBCI or BrainFlow CSV recording", ("file",)),
    Source("streaming", "BrainFlow stream", BoardIds.STREAMING_BOARD, "streaming", "multicast",
           "Receive a stream sent by another BrainFlow program", ("ip_address", "ip_port", "master_board")),
)

BY_KEY = {s.key: s for s in SOURCES}

#: Montage used for the head plot when BrainFlow does not name the channels.
DEFAULT_NAMES = {
    4: ["Fp1", "Fp2", "O1", "O2"],
    8: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2"],
    16: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"],
}


@dataclass
class Layout:
    """What each row of a BrainFlow data chunk holds, for one board."""

    board_id: int
    sampling_rate: int
    eeg: list[int]
    names: list[str]
    accel: list[int] = field(default_factory=list)
    analog: list[int] = field(default_factory=list)
    other: list[int] = field(default_factory=list)
    resistance: list[int] = field(default_factory=list)
    package: int | None = None
    timestamp: int | None = None
    marker: int | None = None
    num_rows: int = 0

    def to_json(self) -> dict:
        return {
            "board_id": self.board_id, "sampling_rate": self.sampling_rate, "eeg": self.eeg, "names": self.names,
            "accel": self.accel, "analog": self.analog, "other": self.other, "resistance": self.resistance,
            "package": self.package, "timestamp": self.timestamp, "marker": self.marker, "num_rows": self.num_rows,
        }


def layout_for(board_id: int) -> Layout:
    d = BoardShim.get_board_descr(board_id)
    eeg = list(d.get("eeg_channels", []))
    names = [n for n in d.get("eeg_names", "").split(",") if n] or DEFAULT_NAMES.get(len(eeg), [f"Ch {i + 1}" for i in range(len(eeg))])
    return Layout(
        board_id=board_id, sampling_rate=int(d["sampling_rate"]), eeg=eeg, names=names[: len(eeg)],
        accel=list(d.get("accel_channels", [])), analog=list(d.get("analog_channels", [])),
        other=list(d.get("other_channels", [])), resistance=list(d.get("resistance_channels", [])),
        package=d.get("package_num_channel"), timestamp=d.get("timestamp_channel"), marker=d.get("marker_channel"),
        num_rows=int(d.get("num_rows", 0)),
    )


def input_params(source: Source, options: dict) -> BrainFlowInputParams:
    """BrainFlow connection parameters from what the user typed in."""
    p = BrainFlowInputParams()
    if options.get("serial_port"):
        p.serial_port = str(options["serial_port"])
    if options.get("mac_address"):
        p.mac_address = str(options["mac_address"])
    if options.get("ip_address"):
        p.ip_address = str(options["ip_address"])
    if options.get("ip_port"):
        p.ip_port = int(options["ip_port"])
    if source.connection == "wifi":
        p.ip_protocol = 2  # TCP, as the OpenBCI WiFi Shield expects
        p.timeout = int(options.get("timeout", 15))
    if source.key == "ganglion_native":
        p.timeout = int(options.get("timeout", 15))
    if source.key == "playback":
        p.file = str(options["file"])
        p.master_board = int(options.get("master_board", BoardIds.CYTON_BOARD))
    if source.key == "streaming":
        p.ip_address = str(options.get("ip_address", "225.1.1.1"))
        p.ip_port = int(options.get("ip_port", 6677))
        p.master_board = int(options.get("master_board", BoardIds.CYTON_BOARD))
    return p


def list_serial_ports() -> list[dict]:
    """Serial ports, with likely OpenBCI dongles first (FTDI for Cyton, BLED112 for Ganglion)."""
    try:
        from serial.tools import list_ports
    except ImportError:  # pragma: no cover - pyserial is a dependency
        return []
    ports = []
    for p in list_ports.comports():
        desc = " ".join(filter(None, [p.description, p.manufacturer or ""])).strip()
        likely = (p.vid == 0x0403) or "FTDI" in desc.upper() or "BLED112" in desc.upper() or "usbserial" in p.device
        ports.append({"device": p.device, "description": desc or p.device, "likely": bool(likely)})
    ports.sort(key=lambda x: (not x["likely"], x["device"]))
    return ports


def catalogue() -> list[dict]:
    """The start-screen list, with each board's channel count and rate."""
    out = []
    for s in SOURCES:
        entry = {"key": s.key, "label": s.label, "family": s.family, "connection": s.connection, "note": s.note, "fields": list(s.fields)}
        if s.board_id >= -1:
            lay = layout_for(s.board_id)
            entry.update(channels=len(lay.eeg), sampling_rate=lay.sampling_rate)
        out.append(entry)
    return out
