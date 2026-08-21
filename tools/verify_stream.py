#!/usr/bin/env python3
"""Ask Cloudflare what it actually has, rather than trusting our own bookkeeping.

The uploader records a file as done when it has sent the last byte. That is not
the same as Cloudflare having accepted and encoded it: a lost response on the
final chunk leaves the video sitting in 'pendingupload' for ever while our
state file says finished. This checks the other end.

    python3 tools/verify_stream.py [--newest]

--newest reports, for every duplicated name, only the most recent copy, which
is what a re-upload leaves behind.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ACCOUNT = "203f021085d63c5fbac9c49b6f5c903c"
TOKEN = (Path.home() / ".cpmb-cf-token").read_text().strip()


def videos() -> list[dict]:
    r = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/stream?per_page=200")
    r.add_header("Authorization", f"Bearer {TOKEN}")
    with urllib.request.urlopen(r, timeout=90) as resp:
        return json.load(resp)["result"]


def main() -> int:
    newest_only = "--newest" in sys.argv
    by_name: dict[str, list[dict]] = defaultdict(list)
    for v in videos():
        by_name[v["meta"].get("name", "?")].append(v)

    bad = 0
    print(f"{'file':46} {'copies':>6} {'state':>14} {'duration':>9}")
    for name in sorted(by_name):
        copies = sorted(by_name[name], key=lambda v: v.get("created", ""))
        show = copies[-1:] if newest_only else copies
        for v in show:
            state = v.get("status", {}).get("state", "?")
            if state != "ready":
                bad += 1
            print(f"{name[:46]:46} {len(copies):>6} {state:>14} "
                  f"{v.get('duration', -1):>8.1f}s")
    print(f"\n{len(by_name)} distinct names, {sum(len(v) for v in by_name.values())} videos"
          f"{'' if not bad else f', {bad} NOT READY'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
