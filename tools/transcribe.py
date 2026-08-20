#!/usr/bin/env python3
"""Transcribe an interview locally, into the archive's transcript format.

    python3 tools/transcribe.py <video-or-audio> <slug> [--model <repo>]

Runs Whisper on this machine (mlx-whisper, Apple Silicon) — no per-film cloud
cost and no account that can lapse, which is what the archive's maintenance
constraint requires.

Whisper mangles exactly the proper nouns this archive is about, so the
vocabulary below is fed to the model as context. Expect to still spend an
hour or so correcting each film by hand: that is budgeted work, not a bug.

Writes content/transcripts/<slug>.json — timed cues that feed captions,
search and (through the segment drafter) the topic map.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "content" / "transcripts"
DEFAULT_MODEL = "mlx-community/whisper-large-v3-mlx"

# The names and projects the archive turns on. Whisper uses this as context,
# which markedly improves proper nouns. Keep it in sync with the vocabulary.
GLOSSARY = (
    "This is an interview about the British architect Cedric Price (1934-2003). "
    "Names and projects that occur: Cedric Price, Joan Littlewood, the Fun Palace, "
    "InterAction Centre, Potteries Thinkbelt, Generator, Magnet, Non-Plan, Polyark, "
    "McAppy, Bathat, Pop-Up Parliament, Hot Stuff Club, Parc de la Villette, "
    "South Bank, Archigram, the Architectural Association, the AA, Reyner Banham, "
    "Frank Newby, Samantha Hardingham, Bureau Europa, Alsop, Tschumi, Obrist."
)


def audio_of(src: Path) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    if src.suffix.lower() == ".wav":
        return src, None
    import imageio_ffmpeg
    tmp = tempfile.TemporaryDirectory()
    wav = Path(tmp.name) / "audio.wav"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error",
                    "-i", str(src), "-vn", "-ac", "1", "-ar", "16000",
                    "-c:a", "pcm_s16le", str(wav), "-y"], check=True)
    return wav, tmp


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    src, slug = Path(args[0]), args[1]
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else DEFAULT_MODEL

    import mlx_whisper
    wav, tmp = audio_of(src)
    print(f"transcribing {src.name} with {model.split('/')[-1]} …", flush=True)
    result = mlx_whisper.transcribe(
        str(wav),
        path_or_hf_repo=model,
        language="en",
        initial_prompt=GLOSSARY,
        word_timestamps=False,
        condition_on_previous_text=False,   # stops runaway repetition
        verbose=False,
    )
    if tmp:
        tmp.cleanup()

    cues = [{"start": round(s["start"], 2), "end": round(s["end"], 2),
             "text": s["text"].strip()} for s in result["segments"] if s["text"].strip()]

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{slug}.json"
    target.write_text(json.dumps({
        "slug": slug,
        "language": result.get("language", "en"),
        "model": model,
        "corrected": False,   # flip to true once a human has been through it
        "cues": cues,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    words = sum(len(c["text"].split()) for c in cues)
    print(f"{len(cues)} cues, {words} words -> {target.relative_to(ROOT)}")
    print("NOT yet corrected — proper nouns need a human pass before publishing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
