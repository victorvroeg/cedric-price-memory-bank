// One WebVTT file per published interview, built from the timed transcript.
// Cue times are in the interview file's own clock, which is what the player's
// video elements run on, so the same file serves whole films and cross-cuts.

import type { APIRoute } from "astro";
import { transcripts } from "../../../lib/content";
import { published } from "../../../lib/crosscut";

export function getStaticPaths() {
  return published()
    .filter((iv) => transcripts.has(iv.slug))
    .map((iv) => ({ params: { slug: iv.slug } }));
}

const stamp = (t: number): string => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
};

// A cue longer than two short lines gets split on word boundaries, its time
// shared out by character count, so the rendered caption never runs past
// two lines of the site's own type.
const MAX_CHARS = 84;
function chunk(c: { start: number; end: number; text: string }) {
  const words = c.text.trim().split(/\s+/);
  const pieces: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > MAX_CHARS) { pieces.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) pieces.push(cur);
  const total = pieces.reduce((a, p) => a + p.length, 0) || 1;
  const span = c.end - c.start;
  let at = c.start;
  return pieces.map((text) => {
    const d = (text.length / total) * span;
    const piece = { start: at, end: at + d, text };
    at += d;
    return piece;
  });
}

export const GET: APIRoute = ({ params }) => {
  const tr = transcripts.get(params.slug!)!;
  const note = tr.corrected ? "" : "NOTE automatic transcription, uncorrected\n\n";
  const body = tr.cues
    .filter((c) => c.end > c.start && c.text.trim())
    .flatMap(chunk)
    .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim().replace(/-->/g, "->")}`)
    .join("\n\n");
  return new Response(`WEBVTT\n\n${note}${body}\n`, {
    headers: { "content-type": "text/vtt; charset=utf-8" },
  });
};
