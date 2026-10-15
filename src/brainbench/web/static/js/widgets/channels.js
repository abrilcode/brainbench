// The "Channels" control in a panel header: which channels a widget uses.
// Stored in the panel's options, so it is saved with the layout.

import { channelColor } from "../charts.js";
import { h } from "../ui.js";

export class ChannelPicker {
  constructor(app, head, options, key = "channels", label = "Channels") {
    this.app = app; this.o = options; this.key = key;
    const n = app.stream.layout.eeg.length;
    if (!Array.isArray(options[key]) || options[key].some((i) => i >= n)) options[key] = Array.from({ length: n }, (_, i) => i);
    this.button = h("button.small", { type: "button", onclick: (e) => { e.stopPropagation(); this.toggle(); } });
    this.pop = h("div.chan-pop", { hidden: true, onclick: (e) => e.stopPropagation() });
    this.wrap = h("span.chan-wrap", {}, this.button, this.pop);
    const opts = head.querySelector(".opts") || head.appendChild(h("div.opts"));
    opts.prepend(this.wrap);
    this.label = label;
    this.render();
    this.close = () => { this.pop.hidden = true; };
    document.addEventListener("click", this.close);
  }

  on(ch) {
    const active = this.app.session?.channels?.[ch]?.active ?? true;
    return active && this.o[this.key].includes(ch);
  }

  render() {
    const L = this.app.stream.layout, sel = this.o[this.key];
    this.button.textContent = `${this.label} ${sel.length}/${L.eeg.length}`;
    this.pop.replaceChildren(
      h("div.inline", {}, h("button.small", { type: "button", onclick: () => this.set(L.eeg.map((_, i) => i)) }, "All"), h("button.small", { type: "button", onclick: () => this.set([]) }, "None")),
      h("div.chan-grid", {}, L.eeg.map((_, i) => h("label.chan", {},
        h("input", { type: "checkbox", checked: sel.includes(i) || undefined, onchange: (e) => this.set(e.target.checked ? [...sel, i].sort((a, b) => a - b) : sel.filter((x) => x !== i)) }),
        h("i.dot", { style: { background: channelColor(i) } }), `${i + 1} ${L.names[i]}`))),
    );
  }

  set(list) { this.o[this.key] = list; this.render(); this.app.workspace.save(); }
  toggle() { this.pop.hidden = !this.pop.hidden; }
  destroy() { document.removeEventListener("click", this.close); }
}
