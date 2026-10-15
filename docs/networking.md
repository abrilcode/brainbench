# Streaming to other programs

The **Networking** widget sends live data to other programs over UDP, LSL, OSC or a serial port. The data types and payloads are the OpenBCI GUI's, so scripts written for the GUI's Networking widget work unchanged. LSL and OSC need the streaming extras (`pip install "brainbench[streaming]"`).

Pick a protocol, choose a data type for each stream (three for UDP and LSL, four for OSC, one for serial), set the address, and press **Start**. The widget lists each stream with the number of messages sent, or the error if one fails.

## Data types

| Type | Values | Rate |
|---|---|---|
| `timeSeriesRaw` | Every EXG channel, µV, unfiltered: channels × new samples | each chunk from the board (~30 per second) |
| `timeSeriesFilt` | The same after the interface's filters | each display frame (~30 per second) |
| `fft` | Amplitude spectrum per channel, µV, first 125 bins | each frame |
| `bandPower` | Delta, theta, alpha, beta, gamma power per channel, as in the Band power widget | each frame |
| `averageBandPower` | The five bands averaged over the channels, as fractions of their sum | each frame |
| `focus` | 1 when the Focus widget's metric is above its threshold, else 0 | each frame (the metric updates once a second) |
| `emg` | Activation per channel, 0–1 | each frame |
| `emgJoystick` | x and y, −1 to 1 | each frame |
| `accelerometer` | x, y, z in g, per sample | each chunk |
| `pulse` | Heart rate (BPM) and inter-beat interval (ms) | each frame while beats are detected |
| `marker` | The marker row, per sample (0 where there is no marker) | each chunk |

The raw time series, accelerometer and marker types are sent by the server straight from the board. The others are computed in the interface, so a browser window must stay open. `focus` and `pulse` come from their widgets, which must be on screen.

## UDP

One JSON object per message, ending in `\r\n`:

```json
{"type": "timeSeriesRaw", "data": [[-3.1, 2.4, ...], [0.8, 1.9, ...], ...]}
```

Default ports are 12345, 12346 and 12347 on 127.0.0.1. Receiving in Python:

```python
import json, socket

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(("127.0.0.1", 12345))
while True:
    msg = json.loads(sock.recv(65536))
    print(msg["type"], len(msg["data"]))
```

## LSL

Each stream is an LSL outlet, `float32`, with the name and type set in the widget (default `obci_eeg1`, `EEG`). The source ID is `brainbench-<type>`.

| Type | Channels | Nominal rate |
|---|---|---|
| `timeSeriesRaw`, `timeSeriesFilt` | one per EXG channel | the board's rate |
| `accelerometer` | 3 | the board's rate |
| `marker` | 1 | the board's rate |
| `fft` | 125 bins, one sample per EXG channel | irregular |
| `bandPower` | 6: channel index, then the five bands; one sample per channel | irregular |
| `averageBandPower` | 5 | irregular |
| `emg` | one per EXG channel | irregular |
| `emgJoystick`, `pulse` | 2 | irregular |
| `focus` | 1 | irregular |

```python
from pylsl import StreamInlet, resolve_byprop

inlet = StreamInlet(resolve_byprop("name", "obci_eeg1")[0])
while True:
    samples, stamps = inlet.pull_chunk()
```

## OSC

Messages go under the address set in the widget (default `/openbci`):

| Type | Address and arguments |
|---|---|
| `timeSeriesRaw`, `timeSeriesFilt` | `/openbci/time-series-raw/ch0`, `/openbci/time-series-filtered/ch0`, …: the channel's new samples |
| `fft` | `/openbci/fft/ch0/bin0`, …: one value |
| `bandPower` | `/openbci/band-power/0`, …: the channel's five bands |
| `averageBandPower` | `/openbci/average-band-power/0` … `/4`: one value |
| `emg` | `/openbci/emg/0`, …: one value |
| `emgJoystick` | `/openbci/emg-joystick/x`, `/y` |
| `accelerometer` | `/openbci/accelerometer/x`, `/y`, `/z`: the new samples |
| `pulse` | `/openbci/pulse/bpm`, `/openbci/pulse/ibi` |
| `focus`, `marker` | `/openbci/focus`, `/openbci/marker` |

## Serial

One line per update, `[v,v,...]` with three decimals, at the chosen baud rate (default 57600). For multi-sample types, each channel's newest sample is sent. This suits an Arduino reading the EMG activation or the focus state:

```
[0.120,0.870,0.040,0.000]
```

## Markers from other programs

BrainBench listens on UDP **127.0.0.1:12350** while a session is open. A 4-byte big-endian float becomes a marker in the data, the recording and the time series, exactly like a key press:

```python
import socket, struct

socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(struct.pack(">f", 3.0), ("127.0.0.1", 12350))
```

This is how a stimulus program (PsychoPy, Unity, a game) can time-lock its events to the EEG.

## BrainFlow streamer

To share the raw board data with other BrainFlow programs instead, tick **Also stream to other BrainFlow programs** on the start screen ([details](hardware.md#streaming-to-other-brainflow-programs)).
