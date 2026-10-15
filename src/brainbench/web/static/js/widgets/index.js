// Every widget, in the order of the panel menus.

import { Accelerometer, AnalogRead, DigitalRead } from "./aux.js";
import { BandPower } from "./bandpower.js";
import { Emg, EmgJoystick } from "./emg.js";
import { FftPlot } from "./fft.js";
import { Focus } from "./focus.js";
import { HeadPlot } from "./headplot.js";
import { Marker, PacketLoss, Pulse } from "./misc.js";
import { Networking } from "./network.js";
import { Playback } from "./playback.js";
import { SignalCheck } from "./signal.js";
import { Spectrogram } from "./spectrogram.js";
import { TimeSeries } from "./timeseries.js";

export const WIDGETS = [
  TimeSeries, FftPlot, BandPower, HeadPlot, Spectrogram, Accelerometer, SignalCheck, Focus, Emg, EmgJoystick,
  Networking, Marker, AnalogRead, DigitalRead, Pulse, PacketLoss, Playback,
];

/** First panels: time series on the left, then FFT, head plot, band power, accelerometer, spectrogram. */
export const DEFAULT_PANELS = [
  { widget: "timeseries" }, { widget: "fft" }, { widget: "headplot" }, { widget: "bandpower" },
  { widget: "accelerometer" }, { widget: "spectrogram" },
];
