// Signal check: electrode impedance and railing.
//   Cyton:    lead-off impedance per pin (P or N), one channel at a time or a
//             timed sweep of all; Live mode shows how close each channel is to railing.
//   Ganglion: the board's own impedance mode (values from BrainFlow).
//   Others:   railing only.

import { channelColor } from "../charts.js";
import { std } from "../dsp.js";
import { railedState } from "../signal-check.js";
import { h } from "../ui.js";

const ANATOMICAL = ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"];

/** OpenBCI: Z = √2 · std(µV) · 1e-6 / 6 nA − 2.2 kΩ, from the last second of filtered data. */
export function impedanceKohm(x) {
  return Math.max(0, (Math.SQRT2 * std(x) * 1e-6) / 6e-9 - 2200) / 1000;
}

export class SignalCheck {
  static id = "signal";
  static title = "Signal check";
  static options = (app) => (app.session?.family === "cyton"
    ? [
      { key: "mode", label: "Mode", default: "impedance", values: [["impedance", "Impedance"], ["live", "Live"]] },
      { key: "interval", label: "Interval", default: 5, values: [4, 5, 7, 10].map((v) => [v, `${v} s`]) },
      { key: "labels", label: "Labels", default: "channel", values: [["channel", "Channel"], ["anatomical", "Anatomical"]] },
      { key: "good", label: "Good below", default: 750, values: [10, 20, 50, 100, 750].map((v) => [v, `${v} kΩ`]) },
      { key: "bad", label: "Bad above", default: 2500, values: [50, 100, 200, 500, 2500].map((v) => [v, `${v} kΩ`]) },
    ] : []);

  constructor(body, app, options, head) {
    this.app = app; this.o = options; this.body = body;
    this.family = app.session?.family;
    this.testing = null; // {ch, pin}
    this.values = {};
    this.wrap = h("div.scroll");
    body.append(this.wrap);
    const opts = head.querySelector(".opts") || head.appendChild(h("div.opts"));
    if (this.family === "cyton") {
      this.sweepBtn = h("button.small", { type: "button", onclick: () => this.sweep() }, "Check all channels");
      opts.prepend(h("button.small", { type: "button", onclick: () => this.reset(), title: "Send the defaults command twice" }, "Reset channels"), this.sweepBtn);
    } else if (this.family === "ganglion") {
      this.gBtn = h("button.small", { type: "button", onclick: () => this.ganglion() }, "Start impedance check");
      opts.prepend(this.gBtn);
    }
    this.build();
  }

  destroy() { this.stopSweep(); if (this.testing) this.test(this.testing.ch, this.testing.pin); if (this.gOn) this.ganglion(); }

  build() {
    const L = this.app.stream.layout;
    this.rows = L.eeg.map((_, ch) => {
      const name = h("span");
      const cells = {};
      const tr = h("tr", {}, h("td", { style: { whiteSpace: "nowrap" } }, h("span.dot", { style: { background: channelColor(ch) } }), name));
      if (this.family === "cyton") {
        for (const pin of ["n", "p"]) {
          const btn = h("button.small", { type: "button", onclick: () => this.test(ch, pin) }, "Test");
          const val = h("span", { style: { fontFamily: "var(--mono)", marginLeft: "8px" } }, "");
          cells[pin] = { btn, val };
          tr.append(h("td", {}, btn, val));
        }
      }
      const status = h("td.num");
      tr.append(status);
      return { tr, name, cells, status };
    });
    const head = this.family === "cyton" ? ["Channel", "N pin", "P pin", "Railing"] : this.family === "ganglion" ? ["Channel", "Impedance"] : ["Channel", "Railing"];
    this.summary = h("p.hint", { style: { margin: "0 0 10px" } });
    this.wrap.replaceChildren(this.summary, h("table.data", {}, h("thead", {}, h("tr", {}, head.map((t) => h("th", {}, t)))), h("tbody", {}, this.rows.map((r) => r.tr))));
    if (this.family === "ganglion") {
      this.ref = h("p.hint");
      this.wrap.append(this.ref);
    }
  }

  async test(ch, pin) {
    const api = this.app.api;
    const same = this.testing && this.testing.ch === ch && this.testing.pin === pin;
    try {
      if (this.testing) await api.impedance(this.testing.ch, false, this.testing.pin);
      this.testing = null;
      if (!same) {
        await api.impedance(ch, true, pin);
        this.testing = { ch, pin };
      }
    } catch (e) { this.app.addLog(e.message); }
  }

  async reset() {
    this.stopSweep();
    for (let i = 0; i < 2; i++) { await this.app.api.command("d").catch((e) => this.app.addLog(e.message)); await new Promise((r) => setTimeout(r, 100)); }
    this.testing = null;
  }

  sweep() {
    if (this.sweepTimer) return this.stopSweep();
    let ch = 0;
    const next = () => {
      if (ch >= this.rows.length) return this.stopSweep();
      this.test(ch, "n");
      ch++;
    };
    next();
    this.sweepTimer = setInterval(next, this.o.interval * 1000);
    this.sweepBtn.textContent = "Stop checking";
  }

  stopSweep() {
    clearInterval(this.sweepTimer); this.sweepTimer = null;
    if (this.sweepBtn) this.sweepBtn.textContent = "Check all channels";
  }

  async ganglion() {
    this.gOn = !this.gOn;
    try { await this.app.api.impedance(null, this.gOn); } catch (e) { this.app.addLog(e.message); }
    this.gBtn.textContent = this.gOn ? "Stop impedance check" : "Start impedance check";
    this.gBtn.classList.toggle("on", this.gOn);
  }

  draw() {
    const { stream, session } = this.app;
    const L = stream.layout;
    let railed = 0;
    this.rows.forEach((r, ch) => {
      r.name.textContent = this.o.labels === "anatomical" ? ` ${ANATOMICAL[ch] || L.names[ch]}` : ` Channel ${ch + 1}`;
      if (this.family === "ganglion") {
        const v = stream.layout.resistance.length ? stream.row(stream.layout.resistance[ch], 1) : [];
        const kohm = v.length ? v.at(-1) / 2 : 0;
        r.status.textContent = this.gOn && kohm > 0 ? `${kohm.toFixed(1)} kΩ` : "–";
        r.status.style.color = !this.gOn || kohm <= 0 ? "" : kohm <= 10 ? "var(--ok)" : kohm <= 50 ? "#6E9E3A" : kohm <= 100 ? "var(--amber)" : kohm <= 150 ? "#E06A3B" : "var(--red)";
        return;
      }
      const rs = railedState(stream.exg(ch, 3, true), session?.channels?.[ch]?.gain ?? 24, session?.family);
      if (rs.level === "bad") railed++;
      r.status.textContent = rs.label || "Not railed";
      r.status.style.color = rs.level === "bad" ? "var(--red)" : rs.level === "warn" ? "var(--amber)" : "var(--ok)";
      if (this.family === "cyton") {
        for (const pin of ["n", "p"]) {
          const c = r.cells[pin];
          const active = this.testing?.ch === ch && this.testing.pin === pin;
          c.btn.classList.toggle("on", active);
          c.btn.textContent = active ? "Stop" : "Test";
          if (active) {
            const kohm = impedanceKohm(stream.exg(ch, 1));
            this.values[`${ch}${pin}`] = kohm;
          }
          const v = this.values[`${ch}${pin}`];
          c.val.textContent = v != null ? `${v.toFixed(1)} kΩ` : "";
          c.val.style.color = v == null ? "" : v < this.o.good ? "var(--ok)" : v < this.o.bad ? "var(--amber)" : "var(--red)";
        }
      }
    });
    if (this.family === "ganglion") {
      const res = stream.layout.resistance;
      const ref = res.length ? stream.row(res.at(-1), 1) : [];
      this.ref.textContent = this.gOn ? `Reference impedance ${ref.length ? (ref.at(-1) / 2).toFixed(1) : "–"} kΩ. Lower is better; under 10 kΩ is very good.` : "Start the check to measure the electrode impedances.";
      this.summary.textContent = "";
    } else if (this.family === "cyton" && this.o.mode === "impedance") {
      this.summary.textContent = session?.streaming
        ? "Test one pin at a time: the lead-off current makes a 31.2 Hz signal whose size gives the electrode's impedance."
        : "Start the stream to measure impedance.";
    } else {
      this.summary.textContent = railed === 0 ? "Looks great! No railed channels." : railed <= 5 ? "A few channels are railed." : "Many channels are railed right now.";
    }
  }
}
