# Feature list

This table maps every feature of the [OpenBCI GUI](https://github.com/OpenBCI/OpenBCI_GUI) (v5/v6) to its place in BrainBench. Behaviour follows the GUI unless the last column says otherwise.

## Data sources and session

| OpenBCI GUI | BrainBench | Notes |
|---|---|---|
| Cyton (serial dongle), with or without Daisy | Start screen → Cyton, Cyton + Daisy | The FTDI port is listed first |
| Cyton over WiFi Shield | Cyton over WiFi Shield | 250, 500 or 1000 Hz |
| Ganglion over BLED112 | Ganglion (BLED112 dongle) | |
| Ganglion over native Bluetooth | Ganglion (Bluetooth) | |
| Ganglion over WiFi Shield | Ganglion over WiFi Shield | 200–1600 Hz |
| Synthetic (4, 8 or 16 channels) | Synthetic | |
| Playback from file | File playback | Also plays BrainFlow CSV |
| Streaming (BrainFlow multicast) | BrainFlow stream | |
| Session name, data format (OpenBCI / BDF+ / off) | Start screen | BrainFlow CSV is offered as a third format |
| Max file duration | *New file every* | 5, 15, 30, 60, 120 minutes or no limit |
| Recording during the stream | *Record automatically while the stream runs*, or **Record** | One folder per session |
| Cyton SD card (5 min to 24 h) | *Also write to the board's SD card* | |
| Radio configuration (status, channel, override, auto-scan) | Start screen → Radio tools | |
| BrainFlow streamer | *Also stream to other BrainFlow programs* | |
| Smoothing (Cyton serial) | Hardware → *Smooth the data flow* | On by default, as in the GUI |
| Start / stop data stream | **Start stream** · Space | |
| Console log | Console bar at the bottom | Plain-language connection errors |

## Signal processing

| OpenBCI GUI | BrainBench | Notes |
|---|---|---|
| Band-pass (default 5–50 Hz) and band-stop, Butterworth / Chebyshev / Bessel, orders 1–8 | Filters | Same defaults; the dialog draws the frequency response |
| Notch 50 Hz / 60 Hz / both / none (default both) | Filters → Mains notch | |
| Global or per-channel filters | Filters → All channels / Per channel | |
| Filter order band-stop → band-pass → notch | Same | |
| Hamming-window FFT, smoothing 0–0.99 (default 0.75), N by sample rate | FFT plot | 256 points at 250 Hz, 512 at 500, 1024 at 1000, 2048 at 1600 |
| Band edges delta 1–4, theta 4–8, alpha 8–13, beta 13–30, gamma 30–55 Hz | Band power, Head plot, Networking | |

## Widgets

| OpenBCI GUI widget | BrainBench widget | Notes |
|---|---|---|
| Time Series | Time series | Scale (default 200 µV), window 1–20 s, raw or filtered, per-channel on/off, RMS and railing per channel; a seek bar during playback |
| FFT Plot | FFT plot | Max frequency and amplitude, log or linear, smoothing, filtered or raw |
| Band Power | Band power | Absolute or relative, smoothing |
| Head Plot | Head plot | Intensity, polarity, contours, smoothing |
| Spectrogram | Spectrogram | Top and bottom channel groups, 30 s to 30 min, log or linear |
| Accelerometer | Accelerometer | |
| Cyton Signal / Ganglion Signal | Signal check | Impedance per pin with settings restored afterwards; railing; thresholds as options |
| Focus | Focus | BrainFlow's MINDFULNESS and RESTFULNESS models, threshold, window, audio feedback |
| EMG | EMG | The GUI's adaptive envelope, with every setting |
| EMG Joystick | EMG joystick | Square-to-disc mapping. The GUI feeds the already-mapped x into the y formula, which lets corners reach a radius of 1.12; BrainBench maps both axes from the inputs, so the point stays on the disc |
| Networking | Networking | UDP, LSL, OSC, serial with the GUI's data types and payloads ([details](networking.md)) |
| Marker | Marker | Eight markers, buttons and keys, a plot of the marker channel; markers from other programs on UDP 12350 |
| Analog Read | Analog read | Switches the board mode with one button |
| Digital Read | Digital read | D11, D12, D13, D17, D18 |
| Pulse Sensor | Pulse sensor | The PulseSensor algorithm on A5, with the real sample period (the GUI assumes 4 ms) |
| Packet Loss | Packet loss | Entire session, current stream, last second, last 10 s and last minute; counter wrap-around is not counted as loss |
| Playback History | Playback | Recent recordings, now playing, seek |

## Hardware settings

| OpenBCI GUI | BrainBench | Notes |
|---|---|---|
| Cyton channel settings (power, gain, input, bias, SRB2, SRB1) | Hardware | Only changed channels are sent; settings save to and load from JSON |
| Channel off: out of bias and SRB2, input shorted; restored when on | Same | Also from the time series' channel numbers |
| Board mode (default, debug, analog, digital, marker) | Analog read, Digital read, Pulse sensor | |
| Ganglion channel on/off, impedance | Hardware, Signal check | |
| Raw commands | Hardware → Send a raw command | |
| Expert-mode keys: 1–8 and !@#$%^&* (channels 1–8 off/on), q–i and Q–I (9–16), n and N (save and load the User settings), ? (print the Cyton's registers), [ and ] (square-wave test signal) | Settings → Expert mode | Same keys. n and N save and load the interface settings; channel settings are saved from the Hardware dialog |
| Marker keys z x c v / Z X C V | Same keys | The GUI reads them only in expert mode. BrainBench reads them at any time, as nothing else uses those keys |
| m (screenshot) | Not included | The browser's own screenshot tools cover it |

## Interface

| OpenBCI GUI | BrainBench | Notes |
|---|---|---|
| Layouts | Layout | Ten arrangements |
| Save / load settings | Settings | Layout, panels, widget options and filters, as named files |
| Help menu, keyboard shortcuts | Help | |
| Desktop application (Processing) | Browser interface served by a Python program | Also runs as an [online demo](https://abrilcode.github.io/brainbench/demo/) with simulated boards |

## Not included

- **Converting raw SD-card files.** The OpenBCI GUI's converter remains the tool for that.
- **Screenshots with m.** The browser's own screenshot tools cover it.
- **Boards beyond Cyton and Ganglion.** BrainFlow supports many more boards, and adding one is a few lines in [`boards.py`](../src/brainbench/boards.py).
