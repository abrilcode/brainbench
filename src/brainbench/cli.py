"""Command line: ``brainbench`` starts the local app and opens the browser."""

from __future__ import annotations

import argparse
import threading
import webbrowser


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="brainbench", description="A modern interface for OpenBCI boards.")
    ap.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8800, help="port (default 8800)")
    ap.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    ap.add_argument("--data-dir", help="where recordings and settings go (default ~/Documents/BrainBench, or $BRAINBENCH_HOME)")
    ap.add_argument("--version", action="store_true")
    args = ap.parse_args(argv)

    from . import __version__
    if args.version:
        print(__version__)
        return

    import os
    from pathlib import Path

    import uvicorn
    from .web.server import create_app

    url = f"http://{args.host}:{args.port}/"
    if not args.no_browser:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    print(f"BrainBench {__version__} at {url}  (Ctrl+C to quit)")
    data_dir = args.data_dir or os.environ.get("BRAINBENCH_HOME")
    uvicorn.run(create_app(Path(data_dir) if data_dir else None), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
