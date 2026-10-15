// OpenBCI CSV ("ODF") in the browser, for recordings made in the online demo.
// Same header and column names as the OpenBCI GUI, so the file plays there too.

const BOARD_CLASS = { cyton: "OpenBCI_GUI$BoardCytonSerial", cyton_daisy: "OpenBCI_GUI$BoardCytonSerialDaisy", ganglion: "OpenBCI_GUI$BoardGanglionBLE" };

export function columnNames(layout, family) {
  const names = Array(layout.num_rows).fill("Other");
  names[layout.timestamp] = "Timestamp";
  names[layout.package] = "Sample Index";
  layout.eeg.forEach((r, i) => { names[r] = `EXG Channel ${i}`; });
  layout.accel.forEach((r, i) => { names[r] = `Accel Channel ${i}`; });
  if (family === "cyton") {
    layout.analog.forEach((r, i) => { names[r] = `Analog Channel ${i}`; });
    [1, 2, 3, 4, 6].forEach((k, i) => { names[layout.other[k]] = `Digital Channel ${i} (${["D11", "D12", "D13", "D17", "D18"][i]})`; });
    names[layout.other[0]] = "Not Used";
    names[layout.other[5]] = "Not Used";
  }
  names[layout.marker] = "Marker Channel";
  return names;
}

const num = (v) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(6)));
const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(sec) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** chunks: Float32Array, row-major (num_rows x cols each). */
export function toOpenBciCsv(chunks, layout, family) {
  const key = family === "cyton" && layout.eeg.length === 16 ? "cyton_daisy" : family;
  const lines = [
    "%OpenBCI Raw EXG Data",
    `%Number of channels = ${layout.eeg.length}`,
    `%Sample Rate = ${layout.sampling_rate} Hz`,
    `%Board = ${BOARD_CLASS[key] || BOARD_CLASS.cyton}`,
    `${columnNames(layout, family).join(", ")}, Timestamp (Formatted)`,
  ];
  const R = layout.num_rows;
  for (const c of chunks) {
    const cols = c.length / R;
    for (let i = 0; i < cols; i++) {
      const row = [];
      for (let r = 0; r < R; r++) row.push(num(c[r * cols + i]));
      lines.push(`${row.join(", ")}, ${stamp(c[layout.timestamp * cols + i])}`);
    }
  }
  return lines.join("\n") + "\n";
}
