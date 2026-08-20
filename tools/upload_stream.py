#!/usr/bin/env python3
"""Upload the interview masters to Cloudflare Stream (resumable, tus).

Browser upload of ~19 GB is fragile: one closed tab and it restarts. This
uploads from disk in 50 MB chunks, survives interruption, and records each
film's playback URL so tools/wire_cloudflare.py can point the archive at it.

Credentials: never passed on the command line and never printed. The script
reads an API token from ~/.cpmb-cf-token (or $CF_STREAM_TOKEN). Create the
token in the Cloudflare dashboard with Account · Stream · Edit, then:

    pbpaste > ~/.cpmb-cf-token && chmod 600 ~/.cpmb-cf-token

Usage:  python3 tools/upload_stream.py [--dry-run] [slug ...]
State:  tools/.stream_uploads.json   (upload URLs + video ids; resumable)
"""

import json
import os
import sys
import urllib.error
import urllib.request
from base64 import b64encode
from pathlib import Path

ACCOUNT = "203f021085d63c5fbac9c49b6f5c903c"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream"
CHUNK = 50 * 1024 * 1024  # must be a multiple of 256 KiB; Cloudflare wants >=5 MB

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT.parent / "video"
STATE = ROOT / "tools" / ".stream_uploads.json"

# master filename (in video/) -> interview slug
FILMS = {
    "1_willasop_def_tc-check.mov": "will-alsop",
    "2_thomweaver_def_tc-check.mov": "thomas-weaver",
    "3_samanthahardingham_def_tc-check.mov": "samantha-hardingham",
    "6_johnfrazer_def_tc-check.mov": "john-frazer",
    "7_jeremymelvin_def_tc-check.mov": "jeremy-melvin",
    "8_carlosbrand_def_tc-check.mov": "carlos-villanueva-brandt",
    "9_brettsteele_def_tc-check.mov": "brett-steele",
    "11_petermurray_def_tc-check.mov": "peter-murray",
    "11_stevemullin_def_tc-check.mov": "steve-mullin",
    "13_paulbarker_def_tc-check.mov": "paul-barker",
    "14_maxneill_def_tc-check.mov": "max-neal",
    "15_bernardtschumi_def_tc-check.mov": "bernard-tschumi",
    # Finch and Obrist are 1080p Vimeo downloads, not 2014 masters — both
    # verified against the topic map to within 0.1 s, so they are the same edit.
    "cedric_price_memory_bank_-_paul_finch_v1 (1080p).mp4": "paul-finch",
    "cedric_price_memory_bank_-_hans_ulrich_obrist_v1 (1080p).mp4": "hans-ulrich-obrist",
}


def token() -> str:
    t = os.environ.get("CF_STREAM_TOKEN")
    if not t:
        p = Path.home() / ".cpmb-cf-token"
        if not p.exists():
            sys.exit("No API token. See the header of this file for how to create one.")
        t = p.read_text().strip()
    if not t:
        sys.exit("Token file is empty.")
    return t


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(s: dict) -> None:
    STATE.write_text(json.dumps(s, indent=2) + "\n")


def request(url: str, method: str, headers: dict, body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def create_upload(path: Path, name: str, tok: str) -> str:
    meta = b64encode(name.encode()).decode()
    status, headers, body = request(API, "POST", {
        "Authorization": f"Bearer {tok}",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": str(path.stat().st_size),
        "Upload-Metadata": f"name {meta},requiresignedurls false",
    })
    if status != 201:
        sys.exit(f"create failed for {name}: HTTP {status} {body[:300].decode(errors='replace')}")
    return headers["Location"]


def upload_offset(url: str, tok: str) -> int:
    status, headers, _ = request(url, "HEAD", {
        "Authorization": f"Bearer {tok}", "Tus-Resumable": "1.0.0"})
    return int(headers.get("Upload-Offset", 0)) if status == 200 else 0


def upload(path: Path, url: str, tok: str) -> None:
    size = path.stat().st_size
    offset = upload_offset(url, tok)
    with path.open("rb") as f:
        while offset < size:
            f.seek(offset)
            chunk = f.read(CHUNK)
            status, headers, body = request(url, "PATCH", {
                "Authorization": f"Bearer {tok}",
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": str(offset),
                "Content-Type": "application/offset+octet-stream",
            }, chunk)
            if status != 204:
                sys.exit(f"chunk failed at {offset}: HTTP {status} "
                         f"{body[:300].decode(errors='replace')}")
            offset = int(headers.get("Upload-Offset", offset + len(chunk)))
            print(f"    {offset / size * 100:5.1f}%  ({offset / 1e9:.2f} GB)", flush=True)


def playback(video_id: str, tok: str) -> dict:
    status, _, body = request(f"{API}/{video_id}", "GET",
                              {"Authorization": f"Bearer {tok}"})
    if status != 200:
        return {}
    r = json.loads(body).get("result", {})
    return {"hls": (r.get("playback") or {}).get("hls"),
            "duration": r.get("duration"),
            "ready": r.get("readyToStream")}


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    tok = token()
    state = load_state()

    todo = []
    for filename, slug in FILMS.items():
        if args and slug not in args:
            continue
        path = VIDEO / filename
        if not path.exists() or path.stat().st_size < 10_000_000:
            continue
        todo.append((slug, path))
    todo.sort()

    print(f"{len(todo)} master(s) present; "
          f"{sum(p.stat().st_size for _, p in todo) / 1e9:.1f} GB total")
    if dry:
        for slug, path in todo:
            done = state.get(slug, {}).get("videoId")
            print(f"  {slug:<26} {path.stat().st_size / 1e9:5.2f} GB "
                  f"{'[already uploaded]' if done else ''}")
        return 0

    for slug, path in todo:
        entry = state.setdefault(slug, {})
        if entry.get("videoId") and entry.get("complete"):
            print(f"skip {slug} (done)")
            continue
        print(f"\n{slug}  ({path.stat().st_size / 1e9:.2f} GB)")
        if not entry.get("uploadUrl"):
            entry["uploadUrl"] = create_upload(path, slug, tok)
            entry["videoId"] = entry["uploadUrl"].rstrip("/").split("/")[-1]
            save_state(state)
        upload(path, entry["uploadUrl"], tok)
        entry["complete"] = True
        entry.update(playback(entry["videoId"], tok))
        save_state(state)
        print(f"  uploaded → {entry['videoId']}")

    print("\ndone. run tools/wire_cloudflare.py once Stream reports readyToStream")
    return 0


if __name__ == "__main__":
    sys.exit(main())
