// Build-time assembly of cross-cut playlists: for a topic, every
// interviewee's segments on it, in a deterministic order.
//
// Order is alphabetical by interview slug. The 2014 site shuffled the
// order on every visit; whether the rebuild should too is an open
// design decision — deterministic order wins for now because it makes
// a cross-cut citable.

import { interviews, cards, type Interview } from "./content";

/** Everything the public archive is built from: approved interviews only. */
export function published(): Interview[] {
  return [...interviews.values()].filter((iv) => !iv.draft);
}

export interface CrossCutItem {
  slug: string;
  name: string;
  jobtitle: string;
  hls: string | null;
  start: number;
  end: number;
  cards: { time: number; title: string }[];
}

export interface CrossCut {
  playable: CrossCutItem[];
  awaiting: { slug: string; name: string; segments: number }[];
}

export function crossCut(topicId: string): CrossCut {
  const playable: CrossCutItem[] = [];
  const awaiting: CrossCut["awaiting"] = [];

  const sorted = published().sort((a, b) => a.slug.localeCompare(b.slug));
  for (const iv of sorted) {
    const segs = iv.segments
      .filter((s) => s.topicId === topicId)
      .sort((a, b) => a.start - b.start);
    if (!segs.length) continue;
    if (!iv.video.hls) {
      awaiting.push({ slug: iv.slug, name: iv.interviewee.name, segments: segs.length });
      continue;
    }
    for (const s of segs) {
      playable.push({
        slug: iv.slug,
        name: iv.interviewee.name,
        jobtitle: iv.interviewee.jobtitle,
        hls: iv.video.hls,
        start: s.start,
        end: s.end,
        cards: iv.cards
          .filter((c) => c.time >= s.start && c.time < s.end)
          .map((c) => ({ time: c.time, title: cards.get(c.cardId)?.title ?? c.cardId })),
      });
    }
  }
  return { playable, awaiting };
}

export function topicsWithSegments(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const iv of published())
    for (const s of iv.segments) counts.set(s.topicId, (counts.get(s.topicId) ?? 0) + 1);
  return counts;
}
