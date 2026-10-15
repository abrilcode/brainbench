"""Builds the online demo for GitHub Pages into _site/.

The demo is the interface itself (src/brainbench/web/static) with the server
replaced by the simulated boards in demo.js. Nothing is copied into the repo:
CI runs this and publishes _site/.

    python scripts/build_demo.py && python -m http.server -d _site
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "src" / "brainbench" / "web" / "static"
SITE = ROOT / "_site"

REDIRECT = """<!doctype html><meta charset="utf-8"><title>BrainBench</title>
<meta http-equiv="refresh" content="0; url=demo/"><link rel="icon" href="demo/favicon.svg" type="image/svg+xml">
<a href="demo/">BrainBench online demo</a>
"""


def main() -> None:
    shutil.rmtree(SITE, ignore_errors=True)
    demo = SITE / "demo"
    shutil.copytree(STATIC, demo, ignore=shutil.ignore_patterns(".DS_Store"))
    index = demo / "index.html"
    html = index.read_text()
    flag = '<script>window.BRAINBENCH_DEMO = true;</script>\n  <script type="module" src="js/main.js"></script>'
    html = html.replace('<script type="module" src="js/main.js"></script>', flag, 1)
    html = html.replace("<title>BrainBench</title>", "<title>BrainBench · online demo</title>", 1)
    index.write_text(html)
    (SITE / "index.html").write_text(REDIRECT)
    (SITE / ".nojekyll").write_text("")
    print(f"built {SITE}")


if __name__ == "__main__":
    main()
