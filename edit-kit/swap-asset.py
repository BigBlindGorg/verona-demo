#!/usr/bin/env python3
"""Find and replace binary assets (images/videos/fonts) served by the live site.

  python3 edit-kit/swap-asset.py reel                 search the asset map
  python3 edit-kit/swap-asset.py 137 new-reel.mp4     replace bin 137 with a file
  python3 edit-kit/swap-asset.py 137 x.jpg --force    skip the type check
"""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".json": "application/json",
    ".js": "text/javascript",
}


def entries():
    sw = (ROOT / "sw.js").read_text()
    M = json.loads("{" + re.search(r"var M=\{(.*?)\};", sw, re.S).group(1) + "}")
    rows = []
    for url, (binpath, ctype) in M.items():
        n = int(re.search(r"(\d+)\.bin$", binpath).group(1))
        rows.append((n, binpath, ctype, url))
    return sorted(rows)


def main():
    force = "--force" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--force"]
    if not args:
        sys.exit(__doc__)

    query = args[0]
    rows = entries()
    if query.isdigit():
        hits = [r for r in rows if r[0] == int(query)]
    else:
        hits = [r for r in rows if query.lower() in r[3].lower()]

    if len(args) == 1:  # search mode
        for n, binpath, ctype, url in hits[:40]:
            p = ROOT / binpath.lstrip("/")
            kb = p.stat().st_size / 1024 if p.exists() else 0
            print(f"{n:>4}  {ctype:24} {kb:9.0f} KB  {url}")
        print(f"({len(hits)} matches)")
        return

    if len(hits) != 1:
        sys.exit(f"need exactly 1 match, got {len(hits)} — use the bin number")
    n, binpath, ctype, url = hits[0]

    new = Path(args[1])
    if not new.exists():
        sys.exit(f"file not found: {new}")
    want = EXT_TYPES.get(new.suffix.lower())
    if want != ctype and not force:
        sys.exit(
            f"type mismatch: bin {n} is {ctype}, {new.name} looks like "
            f"{want or 'unknown'} (--force to override)"
        )

    dst = ROOT / binpath.lstrip("/")
    old_kb = dst.stat().st_size / 1024
    shutil.copyfile(new, dst)
    print(f"replaced bin {n}  ({url})")
    print(f"  {old_kb:.0f} KB -> {dst.stat().st_size / 1024:.0f} KB")
    print('next: ./edit-kit/deploy.sh "swap asset"')


if __name__ == "__main__":
    main()