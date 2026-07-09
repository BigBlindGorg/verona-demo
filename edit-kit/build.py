#!/usr/bin/env python3
"""Repack edit-kit/content/*.json into the live-assets bins the site serves.

Run after editing anything in edit-kit/content/. Safe to run repeatedly:
only writes bins whose content actually changed.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "edit-kit" / "content"

CMS = {
    "metadata.json": r"cms/metadata-dev\.json",
    "contact.json": r"cms/contact-dev\.json",
    "projects.json": r"cms/projects-dev\.json",
}


def sw_map():
    sw = (ROOT / "sw.js").read_text()
    body = re.search(r"var M=\{(.*?)\};", sw, re.S).group(1)
    return json.loads("{" + body + "}")


def compact(data):
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def write_if_changed(path, blob):
    if path.exists() and path.read_bytes() == blob:
        return False
    path.write_bytes(blob)
    return True


def main():
    M = sw_map()
    changed = []

    # 1) CMS JSON -> every bin captured for that CMS file (keeps duplicate captures in sync)
    for name, pat in CMS.items():
        src = CONTENT / name
        if not src.exists():
            print(f"skip {name} (missing)")
            continue
        blob = compact(json.loads(src.read_text()))
        for url, (binpath, _ctype) in M.items():
            if re.search(pat, url):
                p = ROOT / binpath.lstrip("/")
                if write_if_changed(p, blob):
                    changed.append(f"{binpath}  <-  {name}")

    # 2) 3D text + styles -> merged into the UIL blob
    uil_bin = None
    for url, (binpath, _ctype) in M.items():
        if re.search(r"/assets/data/uil\.", url):
            uil_bin = ROOT / binpath.lstrip("/")
            break
    if uil_bin is None:
        sys.exit("ERROR: UIL bin not found in sw.js map")
    uil = json.loads(uil_bin.read_text())

    edits = {}
    for name in ("ui-text.json", "ui-styles.json"):
        src = CONTENT / name
        if src.exists():
            edits.update(json.loads(src.read_text()))
    unknown = [k for k in edits if k not in uil]
    if unknown:
        sys.exit(f"ERROR: keys not in UIL data (typo?): {unknown[:5]}")
    if any(uil[k] != v for k, v in edits.items()):
        uil.update(edits)
        if write_if_changed(uil_bin, compact(uil)):
            changed.append(f"/live-assets/{uil_bin.name}  <-  ui-text.json/ui-styles.json")

    if changed:
        print("updated:")
        for c in changed:
            print("  " + c)
        print("next: ./edit-kit/deploy.sh \"describe your change\"")
    else:
        print("no changes — bins already match edit-kit/content/")


if __name__ == "__main__":
    main()
