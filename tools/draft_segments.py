#!/usr/bin/env python3
"""Draft a topic map for an interview, for a human to correct.

    python3 tools/draft_segments.py --prepare <slug>        > prompt.txt
    python3 tools/draft_segments.py --apply   <slug> <draft.json>

--prepare writes the drafting brief: the interview's transcript with
timecodes, the frozen vocabulary, and the rules. Feed it to any capable
language model (or read it yourself); the answer is a JSON array of
{start, end, topicId}.

--apply checks that answer against the archive's rules and writes it into
content/interviews/<slug>.json. The interview stays draft: true — nothing
reaches the public archive until a person approves it in the review page.

Splitting the work this way means the pipeline does not depend on one
model, one vendor, or one API key that can lapse. See RESURRECT.md.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RULES = """\
Divide this interview into consecutive TOPIC SEGMENTS for an oral-history
archive about the architect Cedric Price. A visitor clicks a topic and
watches every interviewee's turn at it, cut together — so each segment must
stand on its own as a coherent passage on one subject.

Rules:
- Use ONLY the topic ids listed below. The vocabulary is frozen; inventing
  a new topic is a deliberate act that must be logged, not a convenience.
- Segments run in order and must not overlap. Small gaps are fine (asides,
  restarts, dead air); covering every second is not the goal.
- Aim for passages of roughly 30 seconds to 3 minutes — long enough to
  make sense to someone who has not seen the rest of the film.
- Cut on meaning, not on sentences: start where the thought starts.
- A topic may recur if the speaker returns to it later.
- Prefer the specific topic over the general one where both fit.

Answer with JSON only: [{"start": <seconds>, "end": <seconds>,
"topicId": "<id>"}, ...]
"""


def main() -> int:
    argv = sys.argv[1:]
    if "--prepare" in argv:
        slug = argv[argv.index("--prepare") + 1]
        tr = json.loads((ROOT / "content" / "transcripts" / f"{slug}.json").read_text())
        iv = json.loads((ROOT / "content" / "interviews" / f"{slug}.json").read_text())
        topics = sorted(
            (json.loads(p.read_text()) | {"id": p.stem}
             for p in (ROOT / "content" / "topics").glob("*.json")),
            key=lambda t: t["id"])

        print(RULES)
        print(f"Interview: {iv['interviewee']['name']}, "
              f"{iv['video']['duration']:.0f} seconds long.\n")
        print("VOCABULARY (topic id — label):")
        for t in topics:
            print(f"  {t['id']:<22} {t['label']}")
        print("\nTRANSCRIPT (seconds, then speech — machine-made, proper nouns unreliable):")
        for c in tr["cues"]:
            print(f"  {c['start']:7.1f}  {c['text']}")
        return 0

    if "--apply" in argv:
        i = argv.index("--apply")
        slug, draft_path = argv[i + 1], argv[i + 2]
        blob = json.loads(Path(draft_path).read_text())
        # The review tool sends {slug, segments, transcript}; a bare list of
        # segments is still accepted.
        draft = blob["segments"] if isinstance(blob, dict) else blob
        corrected = blob.get("transcript") if isinstance(blob, dict) else None
        target = ROOT / "content" / "interviews" / f"{slug}.json"
        iv = json.loads(target.read_text())
        known = {p.stem for p in (ROOT / "content" / "topics").glob("*.json")}
        duration = iv["video"]["duration"] or 0

        problems, clean = [], []
        last_end = 0.0
        for n, s in enumerate(sorted(draft, key=lambda s: s["start"])):
            if s["topicId"] not in known:
                problems.append(f"segment {n}: unknown topic {s['topicId']!r}")
            if s["end"] <= s["start"]:
                problems.append(f"segment {n}: end before start")
            if s["start"] < last_end - 0.01:
                problems.append(f"segment {n}: overlaps the previous segment")
            if duration and s["end"] > duration + 1:
                problems.append(f"segment {n}: runs past the end of the film")
            last_end = max(last_end, s["end"])
            clean.append({"start": round(float(s["start"]), 2),
                          "end": round(float(s["end"]), 2),
                          "topicId": s["topicId"]})
        if problems:
            for p in problems:
                print("ERROR " + p)
            return 1

        if corrected and corrected.get("cues"):
            tpath = ROOT / "content" / "transcripts" / f"{slug}.json"
            tr = json.loads(tpath.read_text()) if tpath.exists() else {"slug": slug, "language": "en"}
            before = {c["start"]: c["text"] for c in tr.get("cues", [])}
            tr["cues"] = [{"start": c["start"], "end": c["end"], "text": c["text"]}
                          for c in corrected["cues"]]
            tr["corrected"] = bool(corrected.get("corrected", True))
            tpath.write_text(json.dumps(tr, indent=1, ensure_ascii=False) + "\n")
            changed = sum(1 for c in tr["cues"] if before.get(c["start"]) not in (None, c["text"]))
            print(f"transcript updated: {len(tr['cues'])} cues, {changed} edited by hand")

        iv["segments"] = clean
        iv["draft"] = True          # a person still has to approve it
        target.write_text(json.dumps(iv, indent=2, ensure_ascii=False) + "\n")
        covered = sum(s["end"] - s["start"] for s in clean)
        print(f"{len(clean)} draft segments written to {target.relative_to(ROOT)}")
        print(f"covering {covered:.0f}s of {duration:.0f}s "
              f"({covered / duration * 100:.0f}%) — still marked draft, awaiting approval")
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
