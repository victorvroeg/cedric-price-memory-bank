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

export const GET: APIRoute = ({ params }) => {
  const tr = transcripts.get(params.slug!)!;
  const note = tr.corrected ? "" : "NOTE automatic transcription, uncorrected\n\n";
  const body = tr.cues
    .filter((c) => c.end > c.start && c.text.trim())
    .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim().replace(/-->/g, "->")}`)
    .join("\n\n");
  return new Response(`WEBVTT\n\n${note}${body}\n`, {
    headers: { "content-type": "text/vtt; charset=utf-8" },
  });
};
