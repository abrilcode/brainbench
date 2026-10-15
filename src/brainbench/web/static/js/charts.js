// Canvas helpers shared by the widgets: crisp sizing, axes, ticks, colours.

export const THEME = {
  bg: "#FFFFFF", grid: "#EDF2F7", axis: "#C9D4E0", text: "#5B6F86", strong: "#0F2742",
  navy: "#0B3C7A", blue: "#3A7FC1", pale: "#8DB4D9", sky: "#0EA5E9", red: "#C2412D", ok: "#0E7C66", amber: "#B7791F",
  font: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif',
  mono: '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

/** One colour per channel: a blue-led qualitative palette that stays distinct up to 16 channels. */
export const CHANNEL_COLORS = [
  "#0B3C7A", "#3A7FC1", "#0EA5E9", "#0E7C66", "#6E9E3A", "#B7791F", "#C2412D", "#8E4FB0",
  "#1F5FA6", "#5AA0D8", "#14B8A6", "#4D7C0F", "#CA8A04", "#E06A3B", "#A1467E", "#64748B",
];
export const channelColor = (i) => CHANNEL_COLORS[i % CHANNEL_COLORS.length];

/** Matches the canvas's pixel size to its box and the screen's density. Returns the 2D context. */
export function fit(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}

export function text(ctx, s, x, y, { align = "left", base = "alphabetic", color = THEME.text, font = THEME.font, weight = "" } = {}) {
  ctx.font = weight ? `${weight} ${font}` : font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}

export function line(ctx, x0, y0, x1, y1, color = THEME.axis, width = 1, dash = []) {
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(Math.round(x0) + 0.5, Math.round(y0) + 0.5);
  ctx.lineTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Around `n` round values between lo and hi. */
export function ticks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export const fmt = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v)));

/**
 * A plot area with labelled axes. Returns mappers X(v), Y(v) and the inner box.
 * Options: x: [lo, hi], y: [lo, hi], xlabel, ylabel, logY, xticks, yticks.
 */
export function axes(ctx, w, h, { x, y, xlabel = "", ylabel = "", logY = false, pad = {}, xtickFmt = fmt, ytickFmt = fmt, grid = true } = {}) {
  const P = { l: 46, r: 12, t: 10, b: 30, ...pad };
  const iw = Math.max(10, w - P.l - P.r), ih = Math.max(10, h - P.t - P.b);
  const ly = (v) => Math.log10(Math.max(v, 1e-6));
  const [y0, y1] = logY ? [ly(y[0]), ly(y[1])] : y;
  const X = (v) => P.l + ((v - x[0]) / (x[1] - x[0])) * iw;
  const Y = (v) => P.t + ih - (((logY ? ly(v) : v) - y0) / (y1 - y0)) * ih;
  const xt = ticks(x[0], x[1], Math.max(2, Math.floor(iw / 70)));
  const yt = logY ? decades(y[0], y[1]) : ticks(y[0], y[1], Math.max(2, Math.floor(ih / 32)));
  for (const v of xt) {
    if (grid) line(ctx, X(v), P.t, X(v), P.t + ih, THEME.grid);
    line(ctx, X(v), P.t + ih, X(v), P.t + ih + 4, THEME.axis);
    text(ctx, xtickFmt(v), X(v), P.t + ih + 15, { align: "center", font: THEME.mono });
  }
  for (const v of yt) {
    if (grid) line(ctx, P.l, Y(v), P.l + iw, Y(v), THEME.grid);
    line(ctx, P.l - 4, Y(v), P.l, Y(v), THEME.axis);
    text(ctx, ytickFmt(v), P.l - 7, Y(v) + 3.5, { align: "right", font: THEME.mono });
  }
  line(ctx, P.l, P.t, P.l, P.t + ih, THEME.axis);
  line(ctx, P.l, P.t + ih, P.l + iw, P.t + ih, THEME.axis);
  if (xlabel) text(ctx, xlabel, P.l + iw, P.t + ih + 27, { align: "right", color: THEME.text });
  if (ylabel) {
    ctx.save(); ctx.translate(11, P.t + ih / 2); ctx.rotate(-Math.PI / 2);
    text(ctx, ylabel, 0, 0, { align: "center" });
    ctx.restore();
  }
  return { X, Y, box: { x: P.l, y: P.t, w: iw, h: ih } };
}

function decades(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(Math.max(lo, 1e-6))); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  return out.length ? out : [lo, hi];
}

/** Polyline through (xs[i], ys[i]) already in pixels, clipped to a box. */
export function polyline(ctx, pts, color, width = 1.2, box = null) {
  if (pts.length < 2) return;
  ctx.save();
  if (box) { ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip(); }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

/** Colour scale for spectrograms and the head plot: white → pale blue → navy → amber → red. */
const STOPS = [[0, [255, 255, 255]], [0.25, [205, 225, 245]], [0.5, [58, 127, 193]], [0.72, [11, 60, 122]], [0.86, [183, 121, 31]], [1, [194, 65, 45]]];
export function heat(v) {
  v = Math.min(1, Math.max(0, v));
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const k = (v - a) / (b - a);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * k));
    }
  }
  return STOPS.at(-1)[1];
}

/** Diverging scale for the head plot's polarity mode: blue (negative) → white → red (positive). */
export function diverging(v) {
  v = Math.min(1, Math.max(-1, v));
  const a = [58, 127, 193], m = [255, 255, 255], b = [194, 65, 45];
  const [c0, c1, k] = v < 0 ? [m, a, -v] : [m, b, v];
  return c0.map((c, j) => Math.round(c + (c1[j] - c) * k));
}
