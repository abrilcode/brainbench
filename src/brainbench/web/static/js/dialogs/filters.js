// Filters dialog: the mains notch, a band-stop and a band-pass, for all channels
// or per channel, with the combined frequency response drawn live.

import { axes, fit, polyline, THEME } from "../charts.js";
import { design, magnitude } from "../dsp.js";
import { DEFAULT_FILTERS } from "../stream.js";
import { dialog, h } from "../ui.js";

const KINDS = [["butterworth", "Butterworth"], ["chebyshev", "Chebyshev (1 dB)"], ["bessel", "Bessel"]];
const ORDERS = [1, 2, 3, 4, 5, 6, 7, 8];
const BP_PRESETS = [[1, 50], [5, 50], [7, 13], [15, 50], [0.5, 45], [5, 100]];
const NOTCH_PRESETS = [[58, 62, "60 Hz"], [48, 52, "50 Hz"]];
const NOTCH_HZ = { "50": [50], "60": [60], "50+60": [50, 60], none: [] };
const NOTCH_CHOICES = [["50", "50 Hz"], ["60", "60 Hz"], ["50+60", "50 and 60 Hz"], ["none", "Off"]];

export function openFilters(app, onApply) {
  const { stream } = app;
  const fs = stream.fs || 250;
  const draft = structuredClone(stream.filters);
  const n = stream.layout?.eeg.length || 8;
  if (!draft.channels.length) draft.channels = Array.from({ length: n }, () => ({ bandpass: { ...draft.bandpass }, bandstop: { ...draft.bandstop } }));
  let ch = 0; // channel edited in per-channel mode
  const target = () => (draft.perChannel ? draft.channels[ch] : draft);

  const preview = h("canvas");
  function drawPreview() {
    const { ctx, w, h: hh } = fit(preview);
    const t = target();
    const sos = [];
    try {
      if (t.bandstop.on) sos.push(...design({ type: "bandstop", kind: t.bandstop.kind, order: t.bandstop.order, freqs: [t.bandstop.lo, t.bandstop.hi], fs }));
      if (t.bandpass.on) sos.push(...design({ type: "bandpass", kind: t.bandpass.kind, order: t.bandpass.order, freqs: [t.bandpass.lo, Math.min(t.bandpass.hi, fs / 2 * 0.98)], fs }));
      const nyq = fs / 2;
      for (const hz of NOTCH_HZ[draft.notch ?? "50+60"] || []) {
        if (hz + 2 < nyq) sos.push(...design({ type: "bandstop", kind: "butterworth", order: 4, freqs: [hz - 2, hz + 2], fs }));
      }
    } catch { /* invalid range while typing */ }
    const { X, Y, box } = axes(ctx, w, hh, { x: [0, fs / 2], y: [-60, 5], xlabel: "Frequency (Hz)", ylabel: "Gain (dB)", pad: { l: 44 } });
    const pts = [];
    for (let i = 0; i <= 400; i++) {
      const f = (i / 400) * fs / 2;
      const g = sos.length ? 20 * Math.log10(Math.max(1e-6, magnitude(sos, Math.max(f, 0.01), fs))) : 0;
      pts.push([X(f), Y(Math.max(-60, g))]);
    }
    polyline(ctx, pts, THEME.navy, 1.8, box);
  }

  function section(title, key, presets) {
    const box = h("div.card");
    const render = () => {
      const t = target()[key];
      box.replaceChildren(
        h("div.card-title", {}, title, h("label.check", {}, h("input", { type: "checkbox", checked: t.on || undefined, onchange: (e) => { t.on = e.target.checked; drawPreview(); } }), "On")),
        h("div.field-row", {},
          h("label.field", {}, "From (Hz)", h("input", { type: "number", step: "0.5", min: 0.1, value: t.lo, oninput: (e) => { t.lo = +e.target.value; drawPreview(); } })),
          h("label.field", {}, "To (Hz)", h("input", { type: "number", step: "0.5", min: 0.2, value: t.hi, oninput: (e) => { t.hi = +e.target.value; drawPreview(); } }))),
        h("div.field-row", {},
          h("label.field", {}, "Type", h("select", { onchange: (e) => { t.kind = e.target.value; drawPreview(); } }, KINDS.map(([v, l]) => h("option", { value: v, selected: v === t.kind || undefined }, l)))),
          h("label.field", {}, "Order", h("select", { onchange: (e) => { t.order = +e.target.value; drawPreview(); } }, ORDERS.map((o) => h("option", { value: o, selected: o === t.order || undefined }, o))))),
        h("div.inline", { style: { flexWrap: "wrap" } }, presets.map(([lo, hi, label]) => h("button.small", {
          type: "button", onclick: () => { Object.assign(t, { lo, hi, on: true }); render(); drawPreview(); },
        }, label || `${lo}–${hi} Hz`))),
      );
    };
    render();
    box.rerender = render;
    return box;
  }

  return dialog({
    title: "Filters",
    intro: `Applied to the EXG channels for display and analysis. Recordings keep the raw signal. Sampling rate ${fs} Hz.`,
    build: (body) => {
      const stopCard = section("Band-stop", "bandstop", NOTCH_PRESETS);
      const passCard = section("Band-pass", "bandpass", BP_PRESETS);
      const chSel = h("select", { onchange: (e) => { ch = +e.target.value; stopCard.rerender(); passCard.rerender(); drawPreview(); } },
        Array.from({ length: n }, (_, i) => h("option", { value: i }, `Channel ${i + 1}${stream.layout ? ` (${stream.layout.names[i]})` : ""}`)));
      const chWrap = h("label.field", { style: { maxWidth: "240px" } }, "Edit channel", chSel);
      chWrap.hidden = !draft.perChannel;
      body.append(
        h("div.inline", { style: { marginBottom: "12px", gap: "14px" } },
          h("div.seg", {},
            h(`button${draft.perChannel ? "" : ".sel"}`, { type: "button", onclick: (e) => { draft.perChannel = false; chWrap.hidden = true; mark(e); stopCard.rerender(); passCard.rerender(); drawPreview(); } }, "All channels"),
            h(`button${draft.perChannel ? ".sel" : ""}`, { type: "button", onclick: (e) => { draft.perChannel = true; chWrap.hidden = false; mark(e); stopCard.rerender(); passCard.rerender(); drawPreview(); } }, "Per channel")),
          chWrap),
        h("div.inline", { style: { margin: "0 0 12px", gap: "12px" } },
          h("span.field", { style: { margin: 0 } }, "Mains notch, every channel"),
          h("div.seg", {}, NOTCH_CHOICES.map(([v, l]) => h(`button${(draft.notch ?? "50+60") === v ? ".sel" : ""}`, {
            type: "button", onclick: (e) => { draft.notch = v; mark(e); drawPreview(); },
          }, l))),
          h("span.hint", {}, "Butterworth, order 4, ±2 Hz, applied after the filters below")),
        h("div.filter-grid", {}, stopCard, passCard),
        h("div.filter-preview", {}, preview),
      );
      requestAnimationFrame(drawPreview);
    },
    actions: [
      { label: "Reset", run: () => { Object.assign(draft, structuredClone(DEFAULT_FILTERS)); stream.setFilters(draft); localStorage.setItem("brainbench.filters", JSON.stringify(draft)); onApply?.(); document.getElementById("overlay").click(); } },
      { label: "Cancel" },
      { label: "Apply", primary: true, run: (close) => { stream.setFilters(draft); localStorage.setItem("brainbench.filters", JSON.stringify(draft)); onApply?.(); close(true); } },
    ],
  });
}

function mark(e) {
  e.target.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b === e.target));
}
