#!/usr/bin/env python3
"""(Re)initialize edit-kit/content/*.json from the live-assets bins.

WARNING: this OVERWRITES any local edits in edit-kit/content/.
Only run it to reset the kit to what the bins currently contain.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "edit-kit" / "content"


def sw_map():
    sw = (ROOT / "sw.js").read_text()
    return json.loads("{" + re.search(r"var M=\{(.*?)\};", sw, re.S).group(1) + "}")


def bin_for(M, pattern):
    for url, (binpath, _ctype) in M.items():
        if re.search(pattern, url):
            return ROOT / binpath.lstrip("/")
    raise SystemExit(f"no bin matches {pattern}")


def pretty(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"  wrote {path.relative_to(ROOT)}")


def main():
    CONTENT.mkdir(parents=True, exist_ok=True)
    M = sw_map()

    cms = {
        "metadata.json": r"cms/metadata-dev\.json",
        "contact.json": r"cms/contact-dev\.json",
        "projects.json": r"cms/projects-dev\.json",
    }
    for name, pat in cms.items():
        pretty(CONTENT / name, json.loads(bin_for(M, pat).read_text()))

    uil = json.loads(bin_for(M, r"/assets/data/uil\.").read_text())
    texts = {k: v for k, v in uil.items() if k.endswith("_text3d_text")}
    styles = {k: v for k, v in uil.items() if k.endswith("_text3d_fontStyle")}
    pretty(CONTENT / "ui-text.json", texts)
    pretty(CONTENT / "ui-styles.json", styles)
    print(f"  ({len(texts)} 3D text strings, {len(styles)} style blocks)")


if __name__ == "__main__":
    main()
