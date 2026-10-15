# Getting started

## Install

BrainBench needs Python 3.10 or newer. It installs as a command-line program that opens the interface in the browser.

```bash
pipx install git+https://github.com/abrilcode/brainbench
# or, into the current environment:
pip install git+https://github.com/abrilcode/brainbench
```

For LSL and OSC output, add the streaming extras:

```bash
pipx install "brainbench[streaming] @ git+https://github.com/abrilcode/brainbench"
```

Then start it:

```bash
brainbench
```

The interface opens at <http://127.0.0.1:8800>. The server keeps running in the terminal; **Ctrl+C** stops it and closes the board.

| Option | Default | |
|---|---|---|
| `--port` | 8800 | Port of the local server |
| `--host` | 127.0.0.1 | Use `0.0.0.0` to open the interface from another computer on the network |
| `--no-browser` | off | Do not open a browser window |
| `--data-dir` | `~/Documents/BrainBench` | Where recordings and settings files go; `$BRAINBENCH_HOME` sets it too |

## First session without hardware

1. On the start screen, choose **Synthetic** under *Without hardware*.
2. Pick 4, 8 or 16 channels, type a session name, and press **Start session**.
3. Press **Start stream** (or **Space**). The time series, FFT, head plot and band power start moving.
4. Open **Filters** to change the band-pass or the mains notch. The plot in the dialog shows the response before it is applied.

## First recording with a Cyton

1. Plug in the USB dongle and switch the board to **PC**.
2. Choose **Cyton** (or **Cyton + Daisy** for 16 channels) and select the dongle's serial port. The FTDI port is listed first; on macOS it looks like `/dev/cu.usbserial-XXXXXXXX`, on Windows `COM3`, and on Linux `/dev/ttyUSB0`.
3. Leave **Recording format** on *OpenBCI CSV* and **Record automatically** ticked, then press **Start session**.
4. Before recording data, open the **Signal check** widget from any panel's menu. **Check all channels** measures each electrode's impedance in turn.
5. Press **Start stream**. The **REC** pill in the header shows the recording time. Markers go in with **z x c v**.
6. **Stop stream** closes the file. Each session has its own folder under `Documents/BrainBench/Recordings/BrainBench-<session name>/`.

If the board is not found, [Boards and electrodes](hardware.md#troubleshooting) lists the usual causes. The dongle's radio tools are on the start screen under the port.

## Playing a recording back

Choose **File playback** and give the path of a recording. OpenBCI CSV files from BrainBench or from the OpenBCI GUI work, and so do BrainFlow CSV files. The board, the channel count and the sampling rate come from the file.

During playback the time series shows a seek bar under the traces, and the **Playback** widget lists recent recordings. A session can be ended and another file opened from that list.

## Layouts and settings

- **Layout** offers ten panel arrangements. Each panel shows any widget, chosen from the menu in its title. Each widget's options are kept between sessions.
- **Settings** saves the layout, the panels and the filters to a named file in `Documents/BrainBench/Settings`, and loads them back. Channel settings (gain, input type, bias, SRB) belong to the hardware. They are saved from the **Hardware** dialog instead.

## Online demo

<https://abrilcode.github.io/brainbench/demo/> runs the same interface with a simulated Cyton, Cyton + Daisy or Ganglion inside the page. The recording buttons work: the file downloads as OpenBCI CSV when the stream stops. Networking needs the installed app, because a browser page cannot open LSL, OSC, UDP or serial ports.
