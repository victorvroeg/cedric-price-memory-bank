#!/usr/bin/env python3
"""One-shot cleanup of the 2014-era Google Maps URLs in content/cards/*.json.

The recovered `location` fields carry browser-session cruft (client=safari,
ei=..., sa=X, /data=!4m2... blobs). Rewrite each to the shortest URL that
still lands on the same place:

  /maps/place/<name>[/@lat,lng,zoom]  ->  https://www.google.com/maps/place/<name>[/@lat,lng,zoom]
  ?q=<query>                          ->  https://maps.google.com/?q=<query>
  ?sll=<lat,lng> (no q, no place)     ->  https://maps.google.com/?q=<lat,lng>

Anything unrecognised is left untouched and reported.
"""
import glob
import html
import json
import re
import sys
from urllib.parse import urlsplit, parse_qs

CARDS = sorted(glob.glob("content/cards/*.json"))


def clean(url: str) -> str | None:
    raw = html.unescape(url)
    parts = urlsplit(raw)
    if "google" not in parts.netloc:
        return None
    m = re.match(r".*?/maps/(place|search)/([^/]+)(/@[\d.,+-]+z)?", parts.path)
    if m:
        kind, place = m.group(1), m.group(2)
        view = m.group(3) or ""
        return f"https://www.google.com/maps/{kind}/{place}{view}"
    q = parse_qs(parts.query)
    query = (q.get("q") or q.get("sll") or q.get("ll") or [None])[0]
    if query:
        return f"https://maps.google.com/?q={query.replace(' ', '+')}"
    return None


def main() -> None:
    changed, skipped = 0, []
    for path in CARDS:
        with open(path) as fh:
            data = json.load(fh)
        loc = data.get("location")
        if not loc:
            continue
        new = clean(loc)
        if new is None:
            skipped.append((path, loc[:80]))
            continue
        if new != loc:
            data["location"] = new
            with open(path, "w") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
            changed += 1
    print(f"rewrote {changed} of {len(CARDS)} cards")
    for path, loc in skipped:
        print(f"left alone: {path}: {loc}")


if __name__ == "__main__":
    main()
