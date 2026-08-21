// Music the tool plays under the films. Drop a file in public/music/ and it is
// in the archive — no manifest to keep in step, because a manifest is a thing
// that goes stale (see RESURRECT.md, and 2014).
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "public", "music");
const EXT = new Set([".mp3", ".m4a", ".aac", ".ogg", ".wav"]);

export function musicTracks(): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(DIR);
  } catch {
    return []; // no folder, no bed — the archive plays dry and nothing breaks
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return names
    .filter((n) => EXT.has(path.extname(n).toLowerCase()))
    .sort()
    .map((n) => `${base}/music/${encodeURIComponent(n)}`);
}

// stable per-topic pick, so a topic keeps its theme between visits
export function seedOf(slug: string): number {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}
