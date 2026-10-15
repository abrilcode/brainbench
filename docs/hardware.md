# Boards and electrodes

BrainBench connects to every board through [BrainFlow](https://brainflow.readthedocs.io/en/stable/SupportedBoards.html). Board IDs, sample rates and the layout of each data row come from BrainFlow, so they are the same as in the OpenBCI GUI.

| Source | Channels | Rate | Connection |
|---|---|---|---|
| Cyton | 8 | 250 Hz | USB dongle (serial) |
| Cyton + Daisy | 16 | 125 Hz | USB dongle (serial) |
| Cyton over WiFi Shield | 8 | 250–1000 Hz | IP address and port |
| Cyton + Daisy over WiFi Shield | 16 | 250–1000 Hz | IP address and port |
| Ganglion (BLED112 dongle) | 4 | 200 Hz | BLED112 serial port, optional MAC address |
| Ganglion (Bluetooth) | 4 | 200 Hz | The computer's own Bluetooth, optional MAC address |
| Ganglion over WiFi Shield | 4 | 200–1600 Hz | IP address and port |
| Synthetic | 4, 8 or 16 | 250 Hz | none |
| File playback | from the file | from the file | a recording |
| BrainFlow stream | from the sender | from the sender | multicast address, port and the sender's board |

## Cyton channel settings

**Hardware** opens the ADS1299 settings of every channel, as the OpenBCI GUI's channel settings do:

| Setting | Values | Default |
|---|---|---|
| Power | Active, Inactive | Active |
| Gain | ×1, ×2, ×4, ×6, ×8, ×12, ×24 | ×24 |
| Input | Normal, Shorted, Bias measure, MVDD, Temperature, Test signal, Bias DRP, Bias DRN | Normal |
| Bias | Included, not included | Included |
| SRB2 | On, Off | On |
| SRB1 | On, Off | Off |

The settings are sent with the Cyton's `x…X` commands. For example, `x1060110X` sets channel 1 to: power on, gain ×24, normal input, bias on, SRB2 on, SRB1 off. Only changed channels are sent, and only while the stream is stopped, as the board expects.

Switching a channel to **Inactive** also takes it out of the bias and SRB2 and shorts its input. When it comes back on, it gets its previous settings again, as in the OpenBCI GUI. The time series' channel numbers do the same.

The dialog also saves the settings to a JSON file and loads them back, and sends raw commands to the board, such as `?` to print the registers or `d` for the defaults.

## Impedance and railing

**Signal check** has two jobs:

- **Railing:**
  - A channel is *near railed* above 75 % of the converter's range at its gain (±4.5 V / gain), and *railed* above 90 %.
  - The time series shows the same state next to each channel.
- **Impedance (Cyton):**
  - Testing a pin switches on the ADS1299's 6 nA lead-off current at 31.2 Hz.
  - The channel is set to gain ×1, normal input, bias on, SRB2 off and SRB1 off.
  - The impedance is computed from the size of the resulting signal: Z = √2 · σ / 6 nA − 2.2 kΩ, where σ is the standard deviation and 2.2 kΩ is the board's series resistor.
  - Testing one pin at a time gives the clearest reading. **Check all channels** steps through them.
  - The channel's own settings come back when the test ends.
- **Impedance (Ganglion):**
  - The board measures impedance itself (`z` and `Z` commands).
  - BrainBench shows each channel's value and the reference.

Good contact on gelled Ag/AgCl electrodes is usually under 10 kΩ. Dry electrodes read much higher. The *Good below* and *Bad above* thresholds are options of the widget.

## Montage

- The channel labels come from BrainFlow's board descriptions (for the Ganglion, which has none, BrainBench uses the four below). They place the electrodes on the head plot:
  - Cyton: Fp1, Fp2, C3, C4, P7, P8, O1, O2.
  - Daisy adds F7, F8, F3, F4, T7, T8, P3, P4.
  - Ganglion: Fp1, Fp2, O1, O2.
  - The synthetic board: Fz, C3, Cz, C4, Pz, PO7, Oz, PO8 and eight frontal sites.
- **Reference and bias:** the usual Cyton reference is SRB2 (bottom pin row) on one earlobe and BIAS on the other.

## Board modes and auxiliary data

The Cyton's auxiliary data depends on its board mode:

- **Default:** the accelerometer.
- **Analog:** pins A5, A6 and A7 (D11, D12, D13). The Pulse sensor widget reads A5.
- **Digital:** D11, D12, D13, D17 and D18.

The Analog read, Digital read and Pulse widgets switch the mode with one button. The accelerometer is only sent in default mode.

## SD card

With **Also write to the board's SD card**, the Cyton also logs to its SD card for the chosen time (5 minutes to 24 hours; commands `A`, `S`, `F`, `G`, `H`, `J`, `K`, `L`). The file is closed (`j`) when the stream stops. Raw SD files must be converted with the OpenBCI GUI before playback.

## The dongle's radio

The Cyton and its dongle talk on one of 25 radio channels. After re-flashing, or with a board from another kit, they can end up on different channels, and the board then seems to be missing. The radio tools on the start screen send the OpenBCI dongle commands directly:

- **System status:** whether the board answers.
- **Get channel**, **Change channel** (board and dongle) and **Override dongle** (the dongle only).
- **Auto-scan:** moves the dongle through all 25 channels until the board answers.

## WiFi Shield

The computer must be on the Shield's network, or the Shield on the same network as the computer. The Shield's IP address is entered on the start screen, with the sample rate: 250, 500 or 1000 Hz for the Cyton (default 1000), and 200, 400, 800 or 1600 Hz for the Ganglion (default 1600). The two boards use different `~` commands for the same rate, and BrainBench sends the right one.

## Streaming to other BrainFlow programs

**Also stream to other BrainFlow programs** re-sends the board's data on BrainFlow's multicast streamer (`225.1.1.1:6677`). Other programs can read it as a BrainFlow `STREAMING_BOARD`, and so can another BrainBench through the **BrainFlow stream** source.

## Troubleshooting

| Problem | What to check |
|---|---|
| Cyton not found | Board switched to **PC**, dongle switch on **GPIO 6**, the right port, and no other program (another BrainBench, the OpenBCI GUI) holding it. If all of that is right, use the radio tools to check the channel. |
| Data arrives in bursts on Windows | Set the FTDI driver's latency timer from 16 ms to 1 ms (Device Manager → Ports → USB Serial Port → Advanced). |
| Ganglion not found over Bluetooth | Bluetooth on, the Ganglion's blue LED blinking, and no other program connected to it. On macOS, the terminal running BrainBench needs Bluetooth permission. |
| Permission denied on Linux | Add the user to the `dialout` group (`sudo usermod -aG dialout $USER`), then log out and in. |
| A channel reads a flat line or huge noise | The electrode is off or dry. Check it with **Signal check**, or switch the channel off. |
| Strong 50 or 60 Hz | Poor contact, a long reference lead, or a laptop on its charger. The notch removes what remains. |
