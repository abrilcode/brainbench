import pytest

from brainbench import hardware
from brainbench.hardware import ChannelSettings


def test_default_channel_command_matches_the_cyton_power_on_settings():
    # Channel 1, on, gain 24, normal input, in bias, SRB2 on, SRB1 off.
    assert ChannelSettings().command(0) == "x1060110X"


def test_daisy_channels_use_letters():
    assert ChannelSettings(gain=8, input_type="shorted", bias=False, srb2=False).command(8) == "xQ041000X"
    assert ChannelSettings(active=False).command(15) == "xI160110X"


def test_bad_settings_are_rejected():
    with pytest.raises(ValueError):
        ChannelSettings(gain=3).command(0)
    with pytest.raises(ValueError):
        ChannelSettings(input_type="nope").command(0)


def test_impedance_and_toggle_commands():
    assert hardware.impedance_command(2, True, False) == "z310Z"
    assert hardware.channel_toggle_command(0, False) == "1"
    assert hardware.channel_toggle_command(0, True) == "!"
    assert hardware.channel_toggle_command(9, False) == "w"
    assert hardware.channel_toggle_command(3, True, "ganglion") == "$"


def test_full_scale_and_railing():
    assert hardware.full_scale_uv(24) == pytest.approx(187500)
    assert hardware.railed_fraction(93750, 24) == pytest.approx(0.5)
    assert hardware.railed_fraction(1e9, 24) == 1.0


def test_impedance_formula_inverts_the_lead_off_signal():
    # A 10 kOhm electrode gives std = (10000 + 2200) * 6 nA / sqrt(2).
    std_uv = (10000 + 2200) * 6e-9 / 2 ** 0.5 * 1e6
    assert hardware.impedance_ohms(std_uv) == pytest.approx(10000, rel=1e-9)
    assert hardware.impedance_ohms(0) == 0


def test_sample_rate_commands_differ_by_board():
    import pytest

    from brainbench.hardware import sample_rate_command

    assert sample_rate_command("cyton", 1000) == "~4"
    assert sample_rate_command("cyton", 250) == "~6"
    assert sample_rate_command("ganglion", 1600) == "~4"
    assert sample_rate_command("ganglion", 200) == "~7"
    with pytest.raises(ValueError):
        sample_rate_command("cyton", 1600)
