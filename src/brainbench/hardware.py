"""Board settings for Cyton (ADS1299) and Ganglion, as command strings.

The commands follow the OpenBCI SDK documentation and are sent through
BrainFlow's ``config_board``. BrainFlow tracks Cyton gain changes made this
way and rescales the data to microvolts accordingly.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

#: ADS1299 gain settings and their command codes.
GAINS = {1: "0", 2: "1", 4: "2", 6: "3", 8: "4", 12: "5", 24: "6"}

#: ADS1299 input multiplexer settings.
INPUT_TYPES = {
    "normal": "0", "shorted": "1", "bias_meas": "2", "mvdd": "3",
    "temp": "4", "test": "5", "bias_drp": "6", "bias_drn": "7",
}

#: Channel letters: 1-8 on the Cyton, Q-I on the Daisy.
CHANNEL_CHARS = "12345678QWERTYUI"
CHANNEL_OFF = "12345678qwertyui"
CHANNEL_ON = "!@#$%^&*QWERTYUI"

#: Cyton board modes: what the auxiliary bytes carry.
BOARD_MODES = {"default": "/0", "debug": "/1", "analog": "/2", "digital": "/3", "marker": "/4"}

#: Sample-rate commands (used over the WiFi Shield). The two boards number them differently.
SAMPLE_RATES = {16000: "~0", 8000: "~1", 4000: "~2", 2000: "~3", 1000: "~4", 500: "~5", 250: "~6"}
GANGLION_SAMPLE_RATES = {25600: "~0", 12800: "~1", 6400: "~2", 3200: "~3", 1600: "~4", 800: "~5", 400: "~6", 200: "~7"}


def sample_rate_command(family: str, rate: int) -> str:
    table = GANGLION_SAMPLE_RATES if family == "ganglion" else SAMPLE_RATES
    if rate not in table:
        raise ValueError(f"{rate} Hz is not a {family.capitalize()} sample rate; choose one of {sorted(table)}")
    return table[rate]

#: Cyton lead-off impedance test: 6 nA at 31.2 Hz through a 2.2 kOhm series resistor.
LEAD_OFF_AMPS = 6.0e-9
SERIES_OHMS = 2200.0
LEAD_OFF_HZ = 31.2

#: ADS1299 reference voltage.
VREF = 4.5


@dataclass
class ChannelSettings:
    """One ADS1299 channel. The defaults are the Cyton's power-on settings."""

    active: bool = True
    gain: int = 24
    input_type: str = "normal"
    bias: bool = True
    srb2: bool = True
    srb1: bool = False

    def command(self, index: int) -> str:
        """The ``x...X`` command that applies these settings to channel ``index`` (0-based)."""
        if self.gain not in GAINS:
            raise ValueError(f"gain must be one of {sorted(GAINS)}")
        if self.input_type not in INPUT_TYPES:
            raise ValueError(f"input type must be one of {sorted(INPUT_TYPES)}")
        return "x{}{}{}{}{}{}{}X".format(
            CHANNEL_CHARS[index], 0 if self.active else 1, GAINS[self.gain], INPUT_TYPES[self.input_type],
            int(self.bias), int(self.srb2), int(self.srb1),
        )

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> "ChannelSettings":
        return cls(**{k: d[k] for k in ("active", "gain", "input_type", "bias", "srb2", "srb1") if k in d})


def impedance_command(index: int, p: bool, n: bool) -> str:
    """Turns the lead-off current on (or off) for the P and N inputs of a Cyton channel."""
    return "z{}{}{}Z".format(CHANNEL_CHARS[index], int(p), int(n))


def channel_toggle_command(index: int, on: bool, family: str = "cyton") -> str:
    """The single-character command that switches a channel on or off."""
    if family == "ganglion":
        return "!@#$"[index] if on else "1234"[index]
    return CHANNEL_ON[index] if on else CHANNEL_OFF[index]


def full_scale_uv(gain: int) -> float:
    """Largest input the ADS1299 can read at this gain, in microvolts."""
    return VREF / gain * 1e6


def railed_fraction(peak_uv: float, gain: int) -> float:
    """How close a channel is to the converter's limit, from 0 to 1."""
    return min(1.0, abs(peak_uv) / full_scale_uv(gain))


def impedance_ohms(std_uv: float) -> float:
    """Electrode impedance from the RMS of the 31.2 Hz lead-off signal (OpenBCI's formula)."""
    return max(0.0, (2 ** 0.5 * std_uv * 1e-6) / LEAD_OFF_AMPS - SERIES_OHMS)
