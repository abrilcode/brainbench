from brainbench import boards


def test_catalogue_lists_every_openbci_board_and_the_extras():
    keys = {s["key"] for s in boards.catalogue()}
    assert {"cyton", "cyton_daisy", "cyton_wifi", "ganglion", "ganglion_native", "ganglion_wifi", "synthetic", "playback", "streaming"} <= keys


def test_layouts_follow_brainflow():
    cyton = boards.layout_for(boards.BY_KEY["cyton"].board_id)
    assert cyton.sampling_rate == 250 and len(cyton.eeg) == 8 and cyton.names[0] == "Fp1"
    daisy = boards.layout_for(boards.BY_KEY["cyton_daisy"].board_id)
    assert daisy.sampling_rate == 125 and len(daisy.eeg) == 16
    gang = boards.layout_for(boards.BY_KEY["ganglion"].board_id)
    assert len(gang.eeg) == 4 and gang.resistance
    # Ganglion has no channel names in BrainFlow; the default montage fills them in.
    assert gang.names == ["Fp1", "Fp2", "O1", "O2"]


def test_wifi_parameters_use_tcp():
    p = boards.input_params(boards.BY_KEY["cyton_wifi"], {"ip_address": "192.168.4.1", "ip_port": 6677})
    assert p.ip_address == "192.168.4.1" and p.ip_port == 6677 and p.ip_protocol == 2
