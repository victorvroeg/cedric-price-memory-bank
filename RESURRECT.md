# RESURRECT.md

You are reading this because the Cedric Price Memory Bank is broken, or
because everyone who built it is gone. This file is written for a developer
— or anyone with an AI assistant — in 2040 with no context. The 2014
version of this archive died in seven years because knowledge like this
lived in people's heads. Start here.

## What this is

An oral-history archive: filmed interviews about the architect Cedric Price,
each tagged with timecoded topics so visitors can cut across all interviews
by idea. **The irreplaceable part is not the website — it is `content/`:**
the topic map, the cards, and (from M3 on) the transcripts. A human made
those. Everything else can be regenerated.

## The archive with no software

Open `content/interviews/*.json` in any text editor. Each file lists, in
seconds: which topic is discussed from when to when (`segments`), and which
reference cards appear when (`cards`). `content/topics/` is the vocabulary.
That is the whole intellectual asset, legible as plain text. If nothing
else in this repo works, that data plus the master films IS the Memory Bank.

## Rebuild the site

1. Install Node.js (any version close to the one in `package.json`'s era;
   the repo has no other system dependencies).
2. `npm ci && npm run build`
3. `dist/` is the entire site. Serve it from any static host — no server
   code, no database, no accounts required.

If the toolchain itself has rotted beyond repair: the site is a thin layer
over `content/`. Any competent developer or AI assistant can re-render
those JSON files into a new site in days. Do that rather than fighting a
dead framework.

## Re-point the video

Films stream from a managed HLS host. Each interview names its stream in
`video.hls` inside its JSON file. To move hosts: re-upload the masters,
then change those URLs (data only, no code). The single code seam is
`src/lib/resolveVideoSource.ts` if source *kinds* must change.

If the streaming host is dead and no one can transcode: the site still
builds and serves the topic map, cards and transcripts — it degrades,
it does not disappear.

## Where things live (ownership register)

Maintained by Studio Nauta; reviewed whenever either studio's involvement
changes. Fill in — do not let these stay TBD past launch:

| Asset | Where | Owner / account | Notes |
|---|---|---|---|
| This repo | github.com/victorvroeg/cedric-price-memory-bank | Victor Vroegindeweij | The archive itself; staging deploys to GitHub Pages via `tools/deploy-pages.sh` |
| Domain `cedricprice.com` | TBD registrar | TBD | 2014 site still bound to it |
| Streaming host | TBD (pinned at M2) | TBD | Holds transcodes, not masters. Interim: github.com/victorvroeg/cpmb-media-staging (disposable HLS staging on GitHub Pages) |
| Master films | TBD cold storage | TBD | Independent of streaming host |
| 2014 CMS hosting | Hostnet (NL) | TBD | Old WordPress DB + card images still on disk — worth one full backup before the account lapses |

## Provenance

The 2014 topic map in `content/` was recovered in 2026 from a Wayback
Machine capture of the dead CMS's API — the full story, raw payloads and
conversion script are in `archaeology/`. `tools/convert_2014.py` re-derives
`content/` from those payloads deterministically.
