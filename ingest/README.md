# ingest/

Where approved topic maps arrive.

The review tool (`/review/<slug>` on the published site) hands a corrected
topic map back through GitHub's own editor: it opens a new file here,
pre-filled, and the reviewer clicks "Propose changes". That is the whole
publishing path — no server, no account of ours, no token that can expire.

To accept one:

    python3 tools/draft_segments.py --apply <slug> ingest/approved/<slug>.json

then set `"draft": false` in `content/interviews/<slug>.json` once the map
is right, and deploy. See RESURRECT.md.
