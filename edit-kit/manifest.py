#!/usr/bin/env python3
"""Regenerate edit-kit/manifest.md — a human index of every live-assets bin."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    sw = (ROOT / "sw.js").read_text()
    M = json.loads("{" + re.search(r"var M=\{(.*?)\};", sw, re.S).group(1) + "}")

    rows = []
    for url, (binpath, ctype) in M.items():
        p = ROOT / binpath.lstrip("/")
        size = p.stat().st_size if p.exists() else -1
        n = int(re.search(r"(\d+)\.bin$", binpath).group(1))
        rows.append((n, ctype, size, url))
    rows.sort()

    lines = [
        "# live-assets manifest",
        "",
        f"{len(rows)} blobs served by sw.js. `bin N` = `live-assets/N.bin`.",
        "Regenerate with: `python3 edit-kit/manifest.py`",
        "",
        "| bin | type | size | original URL |",
        "|---|---|---|---|",
    ]
    for n, ctype, size, url in rows:
        kb = f"{size / 1024:.0f} KB" if size >= 0 else "MISSING"
        lines.append(f"| {n} | {ctype} | {kb} | {url.replace('|', '&#124;')} |")

    out = ROOT / "edit-kit" / "manifest.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"manifest.md: {len(rows)} rows")


if __name__ == "__main__":
    main()