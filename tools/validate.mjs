#!/usr/bin/env node
// Content integrity gate. Runs before every build (`npm run build`) and fails
// the build on referential errors. The vocabulary is frozen: a segment may only
// point at an existing topic file. Warnings do not fail the build.
//
//   ERROR  segment.topicId without a matching content/topics/<id>.json
//   ERROR  card placement without a matching content/cards/<id>.json
//   ERROR  malformed segment times (end <= start, negative, non-numeric)
//   ERROR  interview missing identity fields
//   WARN   near-duplicate topic labels ("Fun Palace" vs "The Fun Palace")
//   WARN   topics no segment uses, cards no interview places

import { readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const load = (dir) => {
  const out = new Map();
  for (const f of readdirSync(join(ROOT, "content", dir)).filter((f) => f.endsWith(".json"))) {
    out.set(basename(f, ".json"), JSON.parse(readFileSync(join(ROOT, "content", dir, f), "utf8")));
  }
  return out;
};

const topics = load("topics");
const interviews = load("interviews");
const cards = load("cards");
const transcripts = load("transcripts");

const errors = [];
const warnings = [];

const usedTopics = new Set();
const usedCards = new Set();

for (const [slug, iv] of interviews) {
  if (!iv.title || !iv.interviewee?.name) errors.push(`${slug}: missing identity fields`);
  if (!iv.draft && !/^\d{4}-\d{2}-\d{2}$/.test(iv.recorded ?? ""))
    errors.push(`${slug}: published but has no recorded date (the site shows "filmed <month year>")`);
  if (iv.draft) warnings.push(`${slug} is a DRAFT — excluded from the archive until approved`);
  if (!iv.draft && !(transcripts.get(slug)?.cues ?? []).length)
    warnings.push(`${slug}: published but has no transcript, so no captions`);
  else if (!(iv.segments ?? []).length) errors.push(`${slug}: published but has no segments`);
  for (const [i, s] of (iv.segments ?? []).entries()) {
    if (typeof s.start !== "number" || typeof s.end !== "number" || s.start < 0 || s.end <= s.start)
      errors.push(`${slug} segment ${i}: bad times start=${s.start} end=${s.end}`);
    if (!topics.has(s.topicId)) errors.push(`${slug} segment ${i}: unknown topicId "${s.topicId}"`);
    else usedTopics.add(s.topicId);
  }
  for (const [i, c] of (iv.cards ?? []).entries()) {
    if (typeof c.time !== "number" || c.time < 0) errors.push(`${slug} card ${i}: bad time ${c.time}`);
    if (!cards.has(c.cardId)) errors.push(`${slug} card ${i}: unknown cardId "${c.cardId}"`);
    else usedCards.add(c.cardId);
  }
}

// near-duplicate topic labels
const norm = (s) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "");
const dist = (a, b) => {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
};
const entries = [...topics.entries()];
for (let i = 0; i < entries.length; i++)
  for (let j = i + 1; j < entries.length; j++) {
    const [sa, a] = entries[i], [sb, b] = entries[j];
    const na = norm(a.label), nb = norm(b.label);
    if (na === nb || (Math.min(na.length, nb.length) > 4 && dist(na, nb) <= 1))
      warnings.push(`topics "${a.label}" (${sa}) and "${b.label}" (${sb}) look like duplicates`);
  }

for (const t of topics.keys()) if (!usedTopics.has(t)) warnings.push(`topic "${t}" is unused`);
for (const c of cards.keys()) if (!usedCards.has(c)) warnings.push(`card "${c}" is never placed`);

// Moments travel in the fragment, never the query: the player reads #t= only.
import { execSync } from "node:child_process";
try {
  const hits = execSync(
    "grep -rnF --include='*.astro' --include='*.ts' -- '?t=' src/ || true",
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  if (hits) errors.push(`links using ?t= (the player only reads #t=):\n${hits}`);
} catch { /* grep unavailable: skip the check */ }

for (const w of warnings) console.warn("WARN  " + w);
for (const e of errors) console.error("ERROR " + e);
console.log(`\n${interviews.size} interviews, ${topics.size} topics, ${cards.size} cards — ` +
  `${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
