#!/usr/bin/env python3
"""Upload masters to Cloudflare Stream, resumably.

    python3 tools/upload_cloudflare.py <dir-with-masters> [--only NAME]

Browser uploads of multi-gigabyte files are fragile: one closed tab and the
transfer is gone. This uses Stream's resumable (tus) protocol instead, keeps a
state file next to the masters, and can be re-run safely — finished files are
skipped and interrupted ones continue from where they stopped.

Reads the API token from ~/.cpmb-cf-token (never printed).
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = "203f021085d63c5fbac9c49b6f5c903c"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream"
TOKEN = (Path.home() / ".cpmb-cf-token").read_text().strip()
CHUNK = 100 * 1024 * 1024  # 100 MB; must be a multiple of 256 KiB
EXTS = {".mov", ".mp4", ".m4v"}
RETRY_STATUS = {408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}


class TransientHTTP(Exception):
    """A status worth waiting out rather than giving up on."""

    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


def req(url, method, headers, data=None):
    r = urllib.request.Request(url, data=data, method=method)
    for k, v in headers.items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=600) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def human(n):
    return f"{n / 1e9:.2f} GB" if n >= 1e9 else f"{n / 1e6:.0f} MB"


def create(path: Path):
    meta = f"name {base64.b64encode(path.name.encode()).decode()}"
    status, headers, body = req(API, "POST", {
        "Authorization": f"Bearer {TOKEN}",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": str(path.stat().st_size),
        "Upload-Metadata": meta,
    })
    if status not in (200, 201):
        raise RuntimeError(f"create failed ({status}): {body[:300]!r}")
    return headers["Location"], headers.get("stream-media-id")


def offset(location: str) -> int:
    status, headers, _ = req(location, "HEAD", {
        "Authorization": f"Bearer {TOKEN}", "Tus-Resumable": "1.0.0"})
    if status != 200:
        return -1
    return int(headers.get("Upload-Offset", 0))


def send(location: str, path: Path, start: int) -> int:
    size = path.stat().st_size
    sent = start
    with path.open("rb") as fh:
        fh.seek(start)
        while sent < size:
            chunk = fh.read(CHUNK)
            if not chunk:
                break
            t0 = time.time()

            # An hour-long transfer will meet a dropped connection sooner or
            # later; that is weather, not failure. tus already knows how to
            # resume, so ask the server where it got to and carry on from
            # there rather than losing the file. Cloudflare's own 5xx —
            # especially 520, which means its edge could not reach its origin —
            # is the same kind of weather and gets the same treatment.
            for attempt in range(1, 7):
                try:
                    status, headers, body = req(location, "PATCH", {
                        "Authorization": f"Bearer {TOKEN}",
                        "Tus-Resumable": "1.0.0",
                        "Upload-Offset": str(sent),
                        "Content-Type": "application/offset+octet-stream",
                    }, data=chunk)
                    if status not in RETRY_STATUS:
                        break
                    raise TransientHTTP(status)
                except (TimeoutError, OSError, TransientHTTP) as e:
                    wait = min(2 ** attempt, 30)
                    what = f"HTTP {e.status}" if isinstance(e, TransientHTTP) else type(e).__name__
                    print(f"    network hiccup ({what}), "
                          f"retry {attempt}/6 in {wait}s", flush=True)
                    time.sleep(wait)
                    here = offset(location)
                    if here < 0:
                        continue
                    if here != sent:      # the chunk landed after all
                        sent = here
                        fh.seek(sent)
                        chunk = fh.read(CHUNK)
                        if not chunk:
                            return sent
            else:
                raise RuntimeError(f"chunk at {sent}: six retries, giving up")

            if status not in (200, 204):
                raise RuntimeError(f"chunk at {sent} failed ({status}): {body[:200]!r}")
            sent = int(headers.get("Upload-Offset", sent + len(chunk)))
            mbps = len(chunk) / max(time.time() - t0, 0.001) / 1e6 * 8
            print(f"    {human(sent)} / {human(size)}  ({sent / size * 100:4.1f}%, {mbps:.0f} Mbit/s)", flush=True)
    return sent


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    src = Path(args[0])
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    state_path = src / ".cf-uploads.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}

    files = sorted(p for p in src.iterdir() if p.suffix.lower() in EXTS)
    if only:
        files = [p for p in files if only.lower() in p.name.lower()]
    print(f"{len(files)} file(s), {human(sum(p.stat().st_size for p in files))} total\n")

    for i, path in enumerate(files, 1):
        size = path.stat().st_size
        entry = state.get(path.name, {})
        print(f"[{i}/{len(files)}] {path.name}  {human(size)}")

        if entry.get("done"):
            print("    already uploaded\n")
            continue

        location = entry.get("location")
        at = offset(location) if location else -1
        if at < 0:
            location, uid = create(path)
            entry = {"location": location, "uid": uid}
            state[path.name] = entry
            state_path.write_text(json.dumps(state, indent=1))
            at = 0
            print(f"    new upload, id {uid}")
        elif at:
            print(f"    resuming at {human(at)}")

        final = send(location, path, at)
        entry["done"] = final >= size
        state[path.name] = entry
        state_path.write_text(json.dumps(state, indent=1))
        print(f"    {'complete' if entry['done'] else 'INCOMPLETE'}\n", flush=True)

    print("all files uploaded — Cloudflare now encodes them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
