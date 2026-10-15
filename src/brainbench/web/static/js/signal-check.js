// How close a channel is to the converter's limit ("railed"), as in the
// OpenBCI GUI: near railed from 75 % of full scale, railed from 90 %.

const NEAR = 0.75, RAILED = 0.9;

/** Full scale in µV: ADS1299 (Cyton) 4.5 V / gain; MCP3912 (Ganglion) 1.2 V / 1.5 / 51. */
export function fullScaleUv(gain = 24, family = "cyton") {
  return family === "ganglion" ? 1.2e6 / 1.5 / 51 : 4.5e6 / gain;
}

export function railedState(raw, gain = 24, family = "cyton") {
  if (!raw?.length || !["cyton", "ganglion"].includes(family)) return { level: "", label: "", fraction: 0 };
  let peak = 0;
  for (let i = 0; i < raw.length; i++) peak = Math.max(peak, Math.abs(raw[i]));
  const fraction = Math.min(1, peak / fullScaleUv(gain, family));
  const pct = `${Math.round(fraction * 100)} %`;
  if (fraction >= RAILED) return { level: "bad", label: `Railed ${pct}`, fraction };
  if (fraction >= NEAR) return { level: "warn", label: `Near railed ${pct}`, fraction };
  return { level: "", label: pct === "0 %" ? "" : `${pct} of range`, fraction };
}
