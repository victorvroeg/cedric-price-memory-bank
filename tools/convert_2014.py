#!/usr/bin/env python3
"""Convert the recovered 2014 Memory Bank data into the canonical content/ schema.

Input:  archaeology/wayback/interviews_20160518.json   (Wayback capture, 2016-05-18)
        archaeology/wayback/terms_20160518.json
        archaeology/wayback/pages_20160518.json
Output: content/topics/<slug>.json
        content/interviews/<slug>.json
        content/cards/<slug>.json
        content/pages/colofon.json

Deterministic: same input -> byte-identical output. Rerunning overwrites,
EXCEPT the live video fields (video.hls, video.duration) of an existing
interview file, which are preserved: they are operational data set when a
film lands on the streaming host, not part of the 2014 record.

Timecodes in the 2014 CMS are SMPTE HH:MM:SS:FF at 25 fps (PAL production).
They are converted to seconds with frame precision (multiples of 0.04 s).

The 2014 site coloured topics by cycling three colours over the WordPress
term id (see cpmb-2014 .../components/colors/colors.scss):
  id % 3 == 1 -> #AEFEA0 (green)   id % 3 == 2 -> #A1E0FF (blue)
  id % 3 == 0 -> #FFA6A6 (red)
The resolved colour is baked into each topic file so no rule survives here.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WAYBACK = ROOT / "archaeology" / "wayback"
CONTENT = ROOT / "content"

FPS = 25
COLOURS = {1: "#AEFEA0", 2: "#A1E0FF", 0: "#FFA6A6"}

problems = []


def tc_to_seconds(tc: str, where: str) -> float:
    m = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2}):(\d{2})", tc or "")
    if not m:
        problems.append(f"{where}: unparseable timecode {tc!r}")
        return 0.0
    h, mi, s, f = (int(g) for g in m.groups())
    if f >= FPS or s >= 60 or mi >= 60:
        problems.append(f"{where}: out-of-range timecode {tc!r}")
    return round(h * 3600 + mi * 60 + s + f / FPS, 2)


def write(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    interviews_raw = json.loads((WAYBACK / "interviews_20160518.json").read_text())
    terms_raw = json.loads((WAYBACK / "terms_20160518.json").read_text())
    pages_raw = json.loads((WAYBACK / "pages_20160518.json").read_text())

    # ---- topics --------------------------------------------------------
    topics = {}
    for t in terms_raw["terms"]:
        tid = t["term_id"]
        topics[t["slug"]] = {
            "label": t["name"],
            "description": t.get("description") or "",
            "colour": COLOURS[tid % 3],
            "legacy": {"termId": tid},
        }
    for slug, topic in topics.items():
        write(CONTENT / "topics" / f"{slug}.json", topic)

    # ---- interviews + cards -------------------------------------------
    cards = {}  # slug -> card json
    n_segments = 0
    n_placements = 0

    seen_slugs = set()
    for p in sorted(interviews_raw["posts"], key=lambda p: p["title_plain"]):
        iv = p["interview_fields"]
        # The 2014 WP slugs are CMS artifacts ("555-2", "thom"); name the files
        # after the people. The WP slug is kept under legacy.wpSlug.
        slug = re.sub(r"[^a-z0-9]+", "-", p["title_plain"].lower()).strip("-")
        if slug in seen_slugs:
            problems.append(f"interview slug collision: {slug}")
        seen_slugs.add(slug)

        segments = []
        for i, c in enumerate(iv.get("clips") or []):
            subj = c.get("clip_subject")
            if not isinstance(subj, dict):
                problems.append(f"{slug} clip {i}: missing subject")
                continue
            start = tc_to_seconds(c.get("clip_begin_time"), f"{slug} clip {i} begin")
            end = tc_to_seconds(c.get("clip_end_time"), f"{slug} clip {i} end")
            if end <= start:
                problems.append(f"{slug} clip {i} ({subj['slug']}): end {end} <= start {start}")
            segments.append({"start": start, "end": end, "topicId": subj["slug"]})
        segments.sort(key=lambda s: s["start"])
        n_segments += len(segments)

        placements = []
        for i, ic in enumerate(iv.get("infocards") or []):
            time = tc_to_seconds(ic.get("infocard_begin_time"), f"{slug} card {i}")
            for post in ic.get("infocard_card") or []:
                cslug = post["post_name"]
                card = {
                    "title": post["post_title"],
                    "body": post["post_content"],
                    "image": None,  # featured images not in the capture; see archaeology/README.md
                    "legacy": {"postId": post["ID"], "date": post["post_date"]},
                }
                if cslug in cards and cards[cslug]["legacy"]["postId"] != card["legacy"]["postId"]:
                    problems.append(f"card slug collision: {cslug}")
                cards[cslug] = card
                placements.append({"time": time, "cardId": cslug})
        placements.sort(key=lambda c: c["time"])
        n_placements += len(placements)

        vimeo = re.search(r"external/(\d+)", iv.get("url_mp4") or "")
        existing_path = CONTENT / "interviews" / f"{slug}.json"
        live_video = {"hls": None, "duration": None}
        if existing_path.exists():
            prev = json.loads(existing_path.read_text()).get("video") or {}
            live_video = {"hls": prev.get("hls"), "duration": prev.get("duration")}
        write(existing_path, {
            "title": p["title_plain"],
            "interviewee": {
                "name": iv.get("interviewee_name") or p["title_plain"],
                "jobtitle": iv.get("interviewee_jobtitle") or "",
            },
            "recorded": p["date"][:10],
            "video": {
                "hls": live_video["hls"],  # set when the film is on the streaming host
                "duration": live_video["duration"],
                "legacy": {"vimeoId": vimeo.group(1) if vimeo else None,
                           "wpSlug": p["slug"]},
            },
            "segments": segments,
            "cards": placements,
        })

    for cslug, card in sorted(cards.items()):
        write(CONTENT / "cards" / f"{cslug}.json", card)

    # ---- colofon -------------------------------------------------------
    for pg in pages_raw["posts"]:
        write(CONTENT / "pages" / "colofon.json", {
            "title": pg["title_plain"],
            "body": pg["content"],
        })

    n_interviews = len(interviews_raw["posts"])
    print(f"topics: {len(topics)}  interviews: {n_interviews}  "
          f"segments: {n_segments}  cards: {len(cards)}  placements: {n_placements}")
    if problems:
        print(f"\n{len(problems)} data notes:")
        for x in problems:
            print("  -", x)
    return 0


if __name__ == "__main__":
    sys.exit(main())
