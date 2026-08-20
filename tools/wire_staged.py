#!/usr/bin/env python3
"""Wire staged HLS renditions into the content files.

Scans the media-staging working tree for <slug>/index.m3u8, and for each one
sets video.hls (the staging URL) and video.duration (summed from the playlist)
in content/interviews/<slug>.json. Rerunnable; only touches those two fields.
When films move to the permanent streaming host, point BASE elsewhere or edit
the JSON directly — see RESURRECT.md.
"""

import json
import re
import sys
from pathlib import Path

STAGING = Path(
    "/private/tmp/claude-501/-Users-victorvroegindeweij-Developer-cedric-price-memory-bank/"
    "02a451da-fb1f-4e0f-88e0-23a827a3b705/scratchpad/media-staging")
BASE = "https://victorvroeg.github.io/cpmb-media-staging"
CONTENT = Path(__file__).resolve().parent.parent / "content" / "interviews"

for playlist in sorted(STAGING.glob("*/index.m3u8")):
    slug = playlist.parent.name
    target = CONTENT / f"{slug}.json"
    if not target.exists():
        print(f"SKIP {slug}: no interview file", file=sys.stderr)
        continue
    duration = round(sum(float(m) for m in
                         re.findall(r"#EXTINF:([\d.]+)", playlist.read_text())), 2)
    d = json.loads(target.read_text())
    d["video"]["hls"] = f"{BASE}/{slug}/index.m3u8"
    d["video"]["duration"] = duration
    target.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
    print(f"wired {slug}: {duration}s")
