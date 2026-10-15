# File formats

**Recording format** on the start screen picks one of three formats. Every session writes to its own folder, `Documents/BrainBench/Recordings/BrainBench-<session name or date>/`.

## OpenBCI CSV (default)

This is the OpenBCI GUI's own format, so recordings open in the GUI's playback and in any script written for it. GUI recordings likewise play in BrainBench.

```
%OpenBCI Raw EXG Data
%Number of channels = 8
%Sample Rate = 250 Hz
%Board = OpenBCI_GUI$BoardCytonSerial
Sample Index, EXG Channel 0, ..., EXG Channel 7, Accel Channel 0, Accel Channel 1, Accel Channel 2, Not Used, Digital Channel 0 (D11), ..., Analog Channel 0, ..., Timestamp, Marker Channel, Timestamp (Formatted)
0, -3.12, ...
```

- **Columns:** there is one column per BrainFlow row, in BrainFlow's order, with the GUI's column names, then a formatted local time (`2026-10-15 10:18:54.123`).
- **Units:** EXG in µV, accelerometer in g, timestamps in Unix seconds.
- **Separator:** values are separated by `, `, as the GUI writes them.
- **Board line:** the `%Board` line uses the GUI's class names, such as `OpenBCI_GUI$BoardCytonSerialDaisy` or `OpenBCI_GUI$BoardGanglionBLE`. Playback uses it to pick the right board layout.
- **File length:** a new file starts after the chosen maximum duration (5, 15, 30, 60 or 120 minutes, or no limit; default 60), as in the GUI.

## BDF+

BDF+ is 24-bit EDF, read by EEGLAB, MNE-Python, EDFbrowser and most clinical viewers.

- **Layout:** BDF+C (continuous), one-second data records.
- **EXG channels:**
  - Labelled with the electrode names, in µV.
  - The physical range is that of the ADS1299 at each channel's gain: ±4.5 V / gain. The Ganglion uses its own converter range.
  - One digital step is therefore 0.022 µV at gain ×24.
- **Accelerometer:** in g (±4 g).
- **Markers:** stored as annotations in the `BDF Annotations` signal, with their time and value.
- **Last record:** the final partial second is padded with its last sample.

```python
import mne
raw = mne.io.read_raw_bdf("BrainBench-BDF-2026-10-15_10-18-54.bdf", preload=True)
```

## BrainFlow CSV

This is BrainFlow's own format: tab-separated, no header, one line per sample with every row of the board. It is the format `DataFilter.read_file` reads and BrainFlow's playback board plays.

## What playback accepts

| File | Plays |
|---|---|
| OpenBCI CSV from BrainBench or the OpenBCI GUI (v5 or later) | yes. The board, channel count and rate come from the header. |
| BrainFlow CSV | yes. The board is recognised from the number of columns: 24 Cyton, 32 Cyton + Daisy or synthetic, 15 Ganglion. |
| Raw SD-card files (`%STOP AT…`) | no. Convert them with the OpenBCI GUI first. |

Playback loops at the end of the file. The seek bar under the time series jumps to any point.

## Recordings made in the online demo

The demo has no file system, so a recording is kept in the page and downloads as an OpenBCI CSV file when it stops. That file plays back in the installed app and in the OpenBCI GUI.
