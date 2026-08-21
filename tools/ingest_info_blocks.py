#!/usr/bin/env python3
"""Take the references from their source, which is the INFO BLOCKS folder.

What we recovered from the dead 2014 site was the description text and nothing
else. The studio's own INFO BLOCKS folder is the record those pages were built
from, and it carries four things the web copy lost: the image, a subtitle, an
external link, and a map location. Jan Nauta's talk describes all of them --
"I can see what the Commodore PET is, and where it was made, and I can go to an
external website".

    python3 tools/ingest_info_blocks.py [--dry-run]

Bodies are left alone. They are what the archive has been serving and they
match the source text; this only adds what was missing.
"""
from __future__ import annotations

import difflib
import json
import re
import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOCKS = ROOT.parent / "INFO BLOCKS"
CARDS = ROOT / "content" / "cards"
IMAGES = ROOT / "public" / "cards"

# Folders whose names drifted from the card titles. Left is the folder's title
# part, right is the card slug.
ALIASES = {
    "architectural association": "aa",
    "cp aviary": "aviary",
    "cp office alfred place": "alfred-place",
    "wwwh image": "wwwh",
    "potteries (area)": "potteries",
    "george street office xxx": "george-street",
    "dennis cromption": "dennis-crompton",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def read_doc(path: Path) -> dict[str, str]:
    """Pull the labelled fields out of the .docx without a Word dependency."""
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf8", "ignore")
    text = re.sub(r"</w:p>", "\n", xml)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    out: dict[str, str] = {}
    fields = ["Title", "Subtitle", "Description", "External", "Location"]
    for i, f in enumerate(fields):
        rest = "|".join(fields[i + 1:]) or "$"
        m = re.search(rf"{f}:\s*(.*?)(?=\n\s*(?:{rest}):|\Z)", text, re.S)
        if m:
            out[f.lower()] = m.group(1).strip()
    return out


def main() -> int:
    dry = "--dry-run" in sys.argv
    cards = {}
    for f in CARDS.glob("*.json"):
        cards[norm(json.loads(f.read_text())["title"])] = f
    by_slug = {f.stem: f for f in CARDS.glob("*.json")}

    IMAGES.mkdir(parents=True, exist_ok=True)
    matched, noimage, unmatched = [], [], []

    for d in sorted(BLOCKS.iterdir()):
        if not d.is_dir():
            continue
        m = re.match(r"IB\.?\s*(\d+)[_ ]+(.*)", d.name)
        if not m:
            continue
        title = m.group(2).strip()

        target = cards.get(norm(title))
        if not target:
            target = cards.get(norm(re.sub(r"\b(image|images|photo)\b", "", title, flags=re.I)))
        if not target and norm(title) in {norm(k) for k in ALIASES}:
            key = next(k for k in ALIASES if norm(k) == norm(title))
            target = by_slug.get(ALIASES[key])
        if not target:
            # Spelling drifted between the folder and the published card:
            # Vitrivius/Vitruvius, Churchil/Churchill, Cromption/Crompton.
            close = difflib.get_close_matches(norm(title), list(cards), n=1, cutoff=0.84)
            if close:
                target = cards[close[0]]
        if not target:
            unmatched.append(d.name)
            continue

        docs = sorted(d.glob("*.docx"))
        jpgs = sorted(d.glob("*.jpg")) + sorted(d.glob("*.jpeg")) + sorted(d.glob("*.png"))
        rec = read_doc(docs[0]) if docs else {}

        card = json.loads(target.read_text())
        slug = target.stem
        if jpgs:
            dest = IMAGES / f"{slug}{jpgs[0].suffix.lower()}"
            if not dry:
                shutil.copy2(jpgs[0], dest)
            card["image"] = f"/cards/{dest.name}"
        else:
            noimage.append(d.name)
            card["image"] = None

        for key in ("subtitle", "external", "location"):
            v = rec.get(key, "").strip()
            card[key] = v or None
        card.pop("slug", None)     # slug comes from the filename at load time

        if not dry:
            target.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n")
        matched.append(slug)

    print(f"{len(matched)} references updated"
          f"{' (dry run)' if dry else ''}")
    print(f"{len(noimage)} of those had no picture in the folder")
    if unmatched:
        print(f"\n{len(unmatched)} folders matched no card:")
        for u in unmatched:
            print("   ", u)
    return 0


if __name__ == "__main__":
    sys.exit(main())
