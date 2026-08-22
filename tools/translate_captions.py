#!/usr/bin/env python3
"""Translate an interview's transcript into another language, cue by cue.

The English transcript is the source of truth and keeps the timings; a
translation is the same list of cues with the same start and end times and
different words, so a translated caption always lands on the frame of the
sentence it translates.

Cues are sent in overlapping batches with the neighbouring lines as context,
because Whisper splits mid-sentence and a line translated alone loses the
thread. The model returns one line per cue, and the count is checked.

  export ANTHROPIC_API_KEY=...
  python3 tools/translate_captions.py brett-steele --lang ja
  python3 tools/translate_captions.py --all --lang es --skip-existing

Existing files are never overwritten unless --force is given: a human may
have corrected them in the review tool.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRANSCRIPTS = ROOT / "content" / "transcripts"
MODEL = "claude-fable-5"
BATCH = 40          # cues per request
CONTEXT = 3         # cues of lead-in shown but not translated

LANGUAGES = {
    "es": "Spanish", "fr": "French", "pt": "Portuguese (European)",
    "de": "German", "ja": "Japanese",
}

PROMPT = """You are translating the subtitles of a documentary archive about the \
British architect Cedric Price (1934-2003). The speakers are architects, \
critics and friends remembering him, so the English is spoken, digressive and \
full of proper nouns: Fun Palace, Potteries Thinkbelt, InterAction Centre, \
Joan Littlewood, the AA, Bureau Europa.

Translate each numbered line into {language}.

Rules:
- One output line per input line, numbered the same way. Never merge or split lines.
- The lines are subtitle cues cut mid-sentence. Translate each line so that the
  sentence still reads correctly when the lines are shown one after another.
- Keep proper nouns, building names and project titles in their original form.
- Keep the register spoken, not literary. These people are talking, not writing.
- No quotation marks or commentary of your own. Output only the numbered lines.

{context_note}
Lines to translate:
{lines}"""


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def translate_batch(client, texts: list[str], before: list[str], language: str) -> list[str]:
    lines = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(texts))
    context_note = ""
    if before:
        context_note = ("For context only, the lines immediately before these "
                        "(do not translate them):\n" + "\n".join(before) + "\n\n")
    msg = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        messages=[{"role": "user", "content": PROMPT.format(
            language=language, lines=lines, context_note=context_note)}],
    )
    out = msg.content[0].text.strip().splitlines()
    got = []
    for line in out:
        line = line.strip()
        if not line:
            continue
        head, _, rest = line.partition(".")
        got.append(rest.strip() if head.strip().isdigit() else line)
    if len(got) != len(texts):
        raise SystemExit(f"expected {len(texts)} lines back, got {len(got)}")
    return got


def translate(slug: str, lang: str, force: bool) -> None:
    src = TRANSCRIPTS / f"{slug}.json"
    if not src.exists():
        raise SystemExit(f"no English transcript for {slug}")
    out_path = TRANSCRIPTS / f"{slug}.{lang}.json"
    if out_path.exists() and not force:
        print(f"{out_path.name} exists, skipping (use --force to replace)")
        return

    import anthropic
    client = anthropic.Anthropic()

    data = load(src)
    cues = data["cues"]
    language = LANGUAGES[lang]
    done: list[str] = []
    for i in range(0, len(cues), BATCH):
        batch = [c["text"] for c in cues[i:i + BATCH]]
        before = [c["text"] for c in cues[max(0, i - CONTEXT):i]]
        done.extend(translate_batch(client, batch, before, language))
        print(f"  {slug}.{lang}: {len(done)}/{len(cues)}", flush=True)

    out_path.write_text(json.dumps({
        "slug": f"{slug}.{lang}",
        "language": lang,
        "model": MODEL,
        "source": "en",
        "corrected": False,
        "cues": [{"start": c["start"], "end": c["end"], "text": t}
                 for c, t in zip(cues, done)],
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {out_path.name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--lang", required=True, choices=sorted(LANGUAGES))
    ap.add_argument("--all", action="store_true", help="every English transcript")
    ap.add_argument("--force", action="store_true", help="replace an existing translation")
    args = ap.parse_args()

    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("set ANTHROPIC_API_KEY first")

    slugs = args.slugs
    if args.all:
        slugs = sorted(p.stem for p in TRANSCRIPTS.glob("*.json") if "." not in p.stem)
    if not slugs:
        sys.exit("name an interview, or pass --all")

    for slug in slugs:
        translate(slug, args.lang, args.force)


if __name__ == "__main__":
    main()
