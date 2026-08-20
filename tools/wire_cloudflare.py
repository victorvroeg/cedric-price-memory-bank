#!/usr/bin/env python3
"""Point the archive at Cloudflare Stream.

Reads tools/.stream_uploads.json (written by upload_stream.py), asks Stream
for each video's current state, and writes video.hls + video.duration into
content/interviews/<slug>.json. Films Stream has not finished processing are
left untouched and reported, so this is safe to rerun.

The duration written is Stream's own, cross-checked against the topic map;
a disagreement over 2 s is reported rather than silently accepted.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

ACCOUNT = "203f021085d63c5fbac9c49b6f5c903c"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream"
ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "tools" / ".stream_uploads.json"
CONTENT = ROOT / "content" / "interviews"


def token() -> str:
    t = os.environ.get("CF_STREAM_TOKEN")
    if not t:
        p = Path.home() / ".cpmb-cf-token"
        if not p.exists():
            sys.exit("No API token; see tools/upload_stream.py header.")
        t = p.read_text().strip()
    return t


def main() -> int:
    if not STATE.exists():
        sys.exit("No upload state yet — run tools/upload_stream.py first.")
    state = json.loads(STATE.read_text())
    tok = token()
    wired, waiting, flags = [], [], []

    for slug, entry in sorted(state.items()):
        vid = entry.get("videoId")
        if not vid:
            continue
        req = urllib.request.Request(f"{API}/{vid}",
                                     headers={"Authorization": f"Bearer {tok}"})
        with urllib.request.urlopen(req) as r:
            result = json.loads(r.read()).get("result", {})
        if not result.get("readyToStream"):
            pct = (result.get("status") or {}).get("pctComplete", "?")
            waiting.append(f"{slug} ({pct}%)")
            continue

        hls = (result.get("playback") or {}).get("hls")
        duration = round(float(result.get("duration") or 0), 2)
        target = CONTENT / f"{slug}.json"
        d = json.loads(target.read_text())

        ends = [s["end"] for s in d.get("segments", [])]
        map_end = max(ends) if ends else 0
        if duration and abs(duration - map_end) > 2:
            flags.append(f"{slug}: Stream says {duration}s, topic map ends {map_end}s")

        d["video"]["hls"] = hls
        d["video"]["duration"] = duration
        target.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
        wired.append(f"{slug} ({duration}s)")

    for w in wired:
        print("wired  ", w)
    if waiting:
        print("\nstill processing:", ", ".join(waiting))
    if flags:
        print("\nCHECK:")
        for f in flags:
            print("  -", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
