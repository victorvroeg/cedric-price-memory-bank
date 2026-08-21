#!/usr/bin/env python3
"""Point the archive at Cloudflare Stream.

Reads a JSON dump of the Stream video list (the API's `result` array, saved to
a file) and writes each film's playback URL and duration into its content file.

    python3 tools/wire_cloudflare.py stream-videos.json [--dry-run]

Matching is by the uploaded filename, which is why masters keep their 2014
names. A film whose duration disagrees with its topic map by more than 2 s is
reported and NOT wired — that guard is the whole reason the archive's timecodes
can be trusted after a host change.

To move to a different host later, write that host's URLs into video.hls the
same way; nothing else in the site needs to change. See RESURRECT.md.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INTERVIEWS = ROOT / "content" / "interviews"
PAGES = ROOT / "content" / "pages"

# uploaded filename (lowercased, no extension) -> interview slug
FILMS = {
    "1_willasop_def_tc-check": "will-alsop",
    "2_thomweaver_def_tc-check": "thomas-weaver",
    "3_samanthahardingham_def_tc-check": "samantha-hardingham",
    "6_johnfrazer_def_tc-check": "john-frazer",
    "7_jeremymelvin_def_tc-check": "jeremy-melvin",
    "8_carlosbrand_def_tc-check": "carlos-villanueva-brandt",
    "9_brettsteele_def_tc-check": "brett-steele",
    "11_petermurray_def_tc-check": "peter-murray",
    "11_stevemullin_def_tc-check": "steve-mullin",
    "13_paulbarker_def_tc-check": "paul-barker",
    "14_maxneill_def_tc-check": "max-neal",
    "15_bernardtschumi_def_tc-check": "bernard-tschumi",
    "cedric_price_memory_bank_-_paul_finch_v1 (1080p)": "paul-finch",
    "cedric_price_memory_bank_-_hans_ulrich_obrist_v1 (1080p)": "hans-ulrich-obrist",
}
# The opening film Victor re-cut on 2026-08-21, 24.8s. The 2014 trailer
# (cedric_price_memory_bank_-_trailer_v1) is a separate thing and is not the
# front door any more.
INTRO = "cpmb-opening-video"
# Kees Christiaanse has film but no topic map yet — he goes live through the
# ingest pass, not through this script.
HOLD = {"kees christiaanse v02": "kees-christiaanse"}

# Uploaded, kept, but nothing on the site points at it. The 2014 trailer is the
# film Jan Nauta showed in his talk; it is archive material rather than a page.
UNUSED = {"cedric_price_memory_bank_-_trailer_v1"}

TOLERANCE = 2.0

# This account's Stream delivery subdomain (from any video's playback URL).
CUSTOMER = "customer-syg1o9n270h63juf"


def map_basis(slug: str):
    f = INTERVIEWS / f"{slug}.json"
    if not f.exists():
        return None
    d = json.loads(f.read_text())
    ends = [s["end"] for s in d.get("segments", [])] + [c["time"] for c in d.get("cards", [])]
    return max(ends) if ends else None


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        print(__doc__)
        return 2

    videos = json.loads(Path(args[0]).read_text())
    if isinstance(videos, dict):
        videos = videos.get("result", videos.get("videos", []))
    # Accept the compact shape {n: name, u: uid, s: state, d: duration} as well
    # as raw API objects; the compact form is what survives copying by hand.
    videos = [v if "meta" in v else {
        "meta": {"name": v["n"]},
        "playback": {"hls": f"https://{CUSTOMER}.cloudflarestream.com/{v['u']}/manifest/video.m3u8"},
        "status": {"state": v.get("s")},
        "duration": v.get("d"),
    } for v in videos]

    # A re-upload leaves the old copy in the account under the same name. Keep
    # only the newest of each, or the archive would be wired to whichever
    # duplicate the API happened to list first.
    newest: dict[str, dict] = {}
    for v in videos:
        n = (v.get("meta", {}).get("name") or v.get("meta", {}).get("filename") or "")
        if n not in newest or (v.get("created", "") > newest[n].get("created", "")):
            newest[n] = v
    dropped = len(videos) - len(newest)
    if dropped:
        print(f"({dropped} older duplicate{'s' if dropped != 1 else ''} ignored)\n")
    videos = list(newest.values())

    wired, held, problems, missing = [], [], [], dict(FILMS)

    for v in videos:
        name = (v.get("meta", {}).get("name") or v.get("meta", {}).get("filename") or "")
        stem = re.sub(r"\.(mov|mp4|m4v)$", "", name, flags=re.I).strip()
        key = stem.lower()
        hls = (v.get("playback") or {}).get("hls")
        state = (v.get("status") or {}).get("state")
        duration = v.get("duration")

        if key in HOLD:
            held.append(f"{HOLD[key]} ({state}) — awaiting ingest, not wired")
            continue

        if key == INTRO.lower():
            if state != "ready" or not hls:
                problems.append(f"intro: not ready ({state})")
                continue
            p = PAGES / "intro.json"
            d = json.loads(p.read_text())
            d["video"]["hls"] = hls
            d["video"]["duration"] = round(duration, 2) if duration else d["video"]["duration"]
            if not dry:
                p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
            wired.append(f"intro  {round(duration or 0, 2)}s")
            continue

        if key in UNUSED:
            held.append(f"{stem} ({state}) — kept, not used by any page")
            continue

        slug = FILMS.get(key)
        if not slug:
            problems.append(f"unrecognised upload: {name!r}")
            continue
        missing.pop(key, None)

        if state != "ready" or not hls:
            problems.append(f"{slug}: not ready ({state}, {(v.get('status') or {}).get('pctComplete')}%)")
            continue

        basis = map_basis(slug)
        delta = (duration - basis) if (basis and duration) else None
        if delta is None or abs(delta) > TOLERANCE:
            problems.append(f"{slug}: DURATION MISMATCH film={duration} map={basis} delta={delta} — not wired")
            continue

        f = INTERVIEWS / f"{slug}.json"
        d = json.loads(f.read_text())
        d["video"]["hls"] = hls
        d["video"]["duration"] = round(duration, 2)
        if not dry:
            f.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
        wired.append(f"{slug:<26} {round(duration, 2):>8}s  (map {delta:+.2f}s)")

    for line in wired:
        print(("DRY " if dry else "") + "wired " + line)
    for line in held:
        print("held  " + line)
    for line in problems:
        print("!!    " + line)
    for slug in missing.values():
        print(f"!!    {slug}: no upload found")

    print(f"\n{len(wired)} wired, {len(held)} held, {len(problems) + len(missing)} outstanding")
    return 1 if (problems or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
