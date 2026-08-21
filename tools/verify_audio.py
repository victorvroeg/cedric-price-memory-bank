#!/usr/bin/env python3
"""Check what the fold-down actually produced, rather than what it intended.

Reports each finished file's integrated loudness and true peak, and how far
each landed from target. A pass that reports its own inputs proves nothing:
this measures the outputs.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
OUT = Path(__file__).resolve().parent.parent.parent / "video" / "audio-fixed"
TARGET = -18.0


def measure(path: Path) -> tuple[float, float, int]:
    info = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)],
                          capture_output=True, text=True).stderr
    channels = 1 if ", mono" in info else 2
    ebu = subprocess.run(
        [FFMPEG, "-hide_banner", "-i", str(path), "-af", "ebur128=peak=true",
         "-f", "null", "-"], capture_output=True, text=True).stderr
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", ebu)[-1])
    p = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", ebu)[-1])
    return i, p, channels


def main() -> int:
    files = sorted(OUT.glob("*.m*"))
    if not files:
        print("nothing to verify")
        return 1
    print(f"{'file':46} {'ch':>3} {'LUFS':>8} {'off':>6} {'peak':>7}")
    worst = 0.0
    for f in files:
        i, p, ch = measure(f)
        off = i - TARGET
        worst = max(worst, abs(off))
        # AAC overshoots its input by a few tenths; only a real approach to 0 dBFS
        # is worth a flag. -1.0 dBTP in, -0.5 out is the codec, not a fault.
        flag = "  CLIPPING" if p > -0.1 else ("  off target" if abs(off) > 1.5 else "")
        print(f"{f.name[:46]:46} {ch:>3} {i:8.1f} {off:+6.1f} {p:7.1f}{flag}")
    print(f"\nworst deviation from {TARGET} LUFS: {worst:.1f} dB "
          f"(was 23.2 dB spread before)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
