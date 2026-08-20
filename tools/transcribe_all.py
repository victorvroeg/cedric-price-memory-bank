#!/usr/bin/env python3
"""Transcribe every film in the archive that has no transcript yet.

    python3 tools/transcribe_all.py <dir-with-masters> [--force]

Skips films already transcribed unless --force. Uses the same filename ->
slug mapping as the upload tool, so masters keep their 2014 names.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from wire_cloudflare import FILMS  # noqa: E402  (one source of truth for names)

src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "video"
force = "--force" in sys.argv

todo = []
for path in sorted(src.iterdir()):
    stem = path.stem.lower()
    slug = FILMS.get(stem)
    if not slug:
        continue
    out = ROOT / "content" / "transcripts" / f"{slug}.json"
    if out.exists() and not force:
        existing = json.loads(out.read_text())
        if existing.get("cues"):
            print(f"have    {slug}")
            continue
    todo.append((path, slug))

print(f"\n{len(todo)} to transcribe\n", flush=True)
for i, (path, slug) in enumerate(todo, 1):
    print(f"[{i}/{len(todo)}] {slug}", flush=True)
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "transcribe.py"), str(path), slug],
                       capture_output=True, text=True)
    line = [l for l in r.stdout.splitlines() if "cues" in l]
    print("   " + (line[-1] if line else r.stderr.strip()[-160:]), flush=True)
print("\nall transcripts done", flush=True)
