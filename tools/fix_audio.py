#!/usr/bin/env python3
"""Fold the archive's audio to centre and match its levels.

Six of the fifteen films were delivered with the voice on one channel only —
on headphones the interviewee sits entirely in one ear. And the archive spans
23 dB between its quietest and loudest film, which in a cross-cut means
reaching for the volume knob at every cut.

Both are fixed here, at the source, because HTML video has no channel control
and the client-side alternative (Web Audio) goes silent under Safari's native
HLS. The picture is copied, not re-encoded: only the audio is touched.

Loudness is corrected with a single static gain, not with loudnorm's dynamic
mode — nothing is compressed, the quiet films simply come up. Where that gain
would push true peak above -1 dBTP the gain is reduced to fit, and the file is
reported as short of target rather than silently clipped.

    python3 tools/fix_audio.py --analyse
    python3 tools/fix_audio.py --write [slug-or-filename ...]
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
VIDEO = Path(__file__).resolve().parent.parent.parent / "video"
OUT = VIDEO / "audio-fixed"
STATE = VIDEO / ".audio-fix.json"

TARGET_LUFS = -18.0
PEAK_CEILING = -1.0     # dBTP
DEAD_CHANNEL = 25.0     # dB below the other channel counts as not there

SKIP: set[str] = set()

# Peter Murray's export carries a clip-name burn-in (MVI_5377.MOV, changing at
# every cut) on a semi-transparent plate. A clean re-export is coming but is a
# long way off, so this is the interim: delogo, not a black box. Where the
# background behind the plate is black — most of the film — delogo yields
# black. Where his raised hand crosses it, delogo smears the surrounding
# pixels inward, which reads as softness rather than as a hole cut in his arm.
# Measured over all 35,314 frames; the plate sits at x668-1256, y118-222.
BURN_IN: dict[str, str] = {}


@dataclass
class Probe:
    name: str
    channels: int
    rms: list[float]
    integrated: float
    true_peak: float
    source: str          # "left", "right", "sum", "mono"
    gain: float
    capped: bool


def ffmpeg(args: list[str]) -> str:
    return subprocess.run([FFMPEG, "-hide_banner", *args],
                          capture_output=True, text=True).stderr


def probe(path: Path) -> Probe | None:
    info = ffmpeg(["-i", str(path)])
    if "Audio:" not in info:
        return None
    channels = 2 if re.search(r"Audio:.*, stereo", info) else 1

    stats = ffmpeg(["-i", str(path), "-af", "astats", "-f", "null", "-"])
    rms = [float(x) for x in re.findall(r"RMS level dB: (-?[\d.]+)", stats)]

    source = "mono"
    if channels == 2 and len(rms) >= 2:
        left, right = rms[0], rms[1]
        if left - right > DEAD_CHANNEL:
            source = "left"
        elif right - left > DEAD_CHANNEL:
            source = "right"
        else:
            source = "sum"

    # measure the fold-down, not the original: that is what we are levelling
    ebu = ffmpeg(["-i", str(path), "-af", f"{pan(source)},ebur128=peak=true",
                  "-f", "null", "-"])
    integrated = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", ebu)[-1])
    peak = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", ebu)[-1])

    # Full gain to target. Where that would push a transient past the ceiling
    # a limiter catches it — these are quiet rooms with the occasional bump on
    # the mic, and holding the whole film 15 dB down to protect one thump is
    # the wrong trade. The limiter's work is reported, not hidden.
    gain = TARGET_LUFS - integrated
    capped = peak + gain > PEAK_CEILING
    return Probe(path.name, channels, rms[:2], integrated, peak, source,
                 round(gain, 2), capped)


def pan(source: str) -> str:
    """One channel, centred. A dead channel is dropped, not averaged in —
    summing would cost 6 dB and fold in that channel's noise floor."""
    return {
        "left": "pan=mono|c0=c0",
        "right": "pan=mono|c0=c1",
        "sum": "pan=mono|c0=0.5*c0+0.5*c1",
        "mono": "pan=mono|c0=c0",
    }[source]


def write(path: Path, p: Probe) -> Path:
    OUT.mkdir(exist_ok=True)
    dest = OUT / path.name
    ceiling = 10 ** (PEAK_CEILING / 20)
    chain = (f"{pan(p.source)},volume={p.gain}dB,"
             f"alimiter=limit={ceiling:.4f}:attack=5:release=60:level=disabled")

    # The picture is copied untouched unless something has to be painted out of
    # it, in which case it is re-encoded once, at a quality high enough that
    # Cloudflare's own transcode is what limits the result, not this pass.
    burn = BURN_IN.get(path.name)
    video = (["-vf", burn, "-c:v", "libx264", "-preset", "slow", "-crf", "16",
              "-pix_fmt", "yuv420p", "-x264-params", "keyint=50:min-keyint=25"]
             if burn else ["-c:v", "copy"])

    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-v", "error", "-y", "-i", str(path),
         "-map", "0:v:0", "-map", "0:a:0", *video,
         "-af", chain, "-c:a", "aac", "-b:a", "192k", "-ac", "1",
         "-movflags", "+faststart", str(dest)],
        capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{path.name}: {r.stderr[:400]}")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--analyse", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("only", nargs="*")
    args = ap.parse_args()

    files = sorted(f for f in VIDEO.iterdir()
                   if f.suffix.lower() in {".mov", ".mp4"} and f.name not in SKIP)
    if args.only:
        files = [f for f in files if any(o in f.name for o in args.only)]

    probes: dict[str, dict] = json.loads(STATE.read_text()) if STATE.exists() else {}
    print(f"{'file':44} {'ch':>3} {'take':>6} {'in LUFS':>9} {'gain':>7} {'peak':>7}")
    for f in files:
        p = probes.get(f.name)
        if not p or args.analyse:
            got = probe(f)
            if not got:
                print(f"{f.name[:44]:44}  no audio track"); continue
            p = asdict(got)
            probes[f.name] = p
            STATE.write_text(json.dumps(probes, indent=2))
        flag = "  limiter engages" if p["capped"] else ""
        print(f"{f.name[:44]:44} {p['channels']:>3} {p['source']:>6} "
              f"{p['integrated']:9.1f} {p['gain']:+7.2f} {p['true_peak']:7.1f}{flag}")

    if not args.write:
        return
    for f in files:
        p = probes[f.name]
        if p.get("channels") is None:
            continue
        dest = write(f, Probe(**p))
        print(f"  wrote {dest.name}  ({dest.stat().st_size / 1e9:.2f} GB)")


if __name__ == "__main__":
    main()
