# Cedric Price Memory Bank

Interviews with the network of Cedric Price (1934–2003), cut sideways by
topic: click an idea and every interviewee takes a turn at it. Originally
made in 2014 (Studio Nauta, The Office for Non-fiction Storytelling, Mieras,
CKDT, Bruce Moerdjiman, commissioned by Bureau Europa); rebuilt from the
ground up in 2026 as a project of **Early Studios** (build) and
**Studio Nauta** (maintain).

The archive is designed to grow to ~30 interviews and to survive ~25 years
of neglect. Those two facts drive everything:

- **The whole site is static.** No server, no database, no runtime API.
  The built output is plain files; nothing deployed can lapse.
- **Content is the repo.** `content/` holds the archive as human-readable
  JSON — readable with no software, versioned in git. Video files are the
  only thing living elsewhere (a streaming host + cold-storage masters),
  and `RESURRECT.md` explains how to re-point or rebuild everything.

## Layout

| Path | What |
|---|---|
| `content/interviews/*.json` | One file per interview: identity, video ref, timecoded topic segments, card placements |
| `content/topics/*.json` | The controlled vocabulary (37 topics, frozen) |
| `content/cards/*.json` | Reference cards shown during playback |
| `content/transcripts/` | Timed transcript cues (arrives at M3) |
| `archaeology/` | The recovered 2014 dataset and its provenance — see its README |
| `tools/convert_2014.py` | Deterministic conversion: recovered 2014 data → `content/` |
| `tools/validate.mjs` | Content integrity gate; `npm run build` refuses bad data |
| `src/` | The Astro site (static output, islands only where interaction demands) |

## Commands

```
npm ci             # install pinned dependencies
npm run dev        # local preview
npm run build      # validate content, then build the static site into dist/
npm run validate   # content check alone
```

## Status

- **M0 archaeology — done.** The complete 2014 topic map (14 interviews,
  182 segments, 37 topics, 204 cards) was recovered from a 2016 Wayback
  Machine capture of the CMS API. See `archaeology/README.md`.
- **M1 foundation — done.** Static site, projection treatment, player,
  scrub, topic seeking, all running on the recovered data. Video plays a
  placeholder stream until films are transcoded onto the streaming host.
- **M2 next: the cross-cut engine** (topic playlists across films,
  desktop + iOS Safari). This is the point of no return in the plan.

Open items: Apercu web licence confirmation; Cloudflare Stream vs Bunny
(pin at M2); 2014 release language re: re-publication and transcription;
card images (recoverable via the CMS host — see archaeology README).
