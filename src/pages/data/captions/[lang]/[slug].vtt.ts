// One WebVTT file per interview per language, built from the timed
// transcripts. Cue times are always the English ones, in the interview file's
// own clock, which is what the player's video elements run on, so the same
// file serves whole films and cross-cuts, in any language.

import type { APIRoute } from "astro";
import { transcripts } from "../../../../lib/content";
import { published } from "../../../../lib/crosscut";
import { LANGUAGES, transcriptKey } from "../../../../lib/languages";

export function getStaticPaths() {
  const paths = [];
  for (const iv of published())
    for (const lang of LANGUAGES)
      if (transcripts.has(transcriptKey(iv.slug, lang.code)))
        paths.push({ params: { lang: lang.code, slug: iv.slug } });
  return paths;
}

const stamp = (t: number): string => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(3).padStart(6, "0");
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s}`;
};

// A cue longer than two short lines gets split on word boundaries, its time
// shared out by character count, so the rendered caption never runs past
// two lines of the site's own type. Japanese has no spaces to split on and
// sets far more compactly, so it is measured and cut differently.
const LIMIT: Record<string, number> = { ja: 34 };
const DEFAULT_LIMIT = 84;

function chunk(c: { start: number; end: number; text: string }, lang: string) {
  const max = LIMIT[lang] ?? DEFAULT_LIMIT;
  const text = c.text.trim();
  const units = lang === "ja" ? [...text] : text.split(/\s+/);
  const join = lang === "ja" ? "" : " ";
  const pieces: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + join.length + u.length > max) { pieces.push(cur); cur = u; }
    else cur = cur ? cur + join + u : u;
  }
  if (cur) pieces.push(cur);
  const total = pieces.reduce((a, p) => a + p.length, 0) || 1;
  const span = c.end - c.start;
  let at = c.start;
  return pieces.map((t) => {
    const d = (t.length / total) * span;
    const piece = { start: at, end: at + d, text: t };
    at += d;
    return piece;
  });
}

export const GET: APIRoute = ({ params }) => {
  const lang = params.lang!;
  const tr = transcripts.get(transcriptKey(params.slug!, lang))!;
  const note = tr.corrected
    ? ""
    : lang === "en"
      ? "NOTE automatic transcription, uncorrected\n\n"
      : "NOTE machine translation of the English transcript, uncorrected\n\n";
  const body = tr.cues
    .filter((c) => c.end > c.start && c.text.trim())
    .flatMap((c) => chunk(c, lang))
    .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim().replace(/-->/g, "->")}`)
    .join("\n\n");
  return new Response(`WEBVTT\n\n${note}${body}\n`, {
    headers: { "content-type": "text/vtt; charset=utf-8" },
  });
};
