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
  /** the theme this turn is on, or null for a whole film */
  topicId: string | null;
  /** the themes running inside this turn, so the player can always name one */
  segments: { start: number; end: number; topicId: string }[];
  cards: { time: number; title: string; id: string }[];
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
        topicId,
        segments: [{ start: s.start, end: s.end, topicId }],
        cards: iv.cards
          .filter((c) => c.time >= s.start && c.time < s.end)
          .map((c) => ({
            time: c.time,
            title: cards.get(c.cardId)?.title ?? c.cardId,
            id: c.cardId,
          })),
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


/** One interview as a single playable turn: the whole film, top to bottom. */
export function wholeFilm(slug: string): CrossCutItem | null {
  const iv = interviews.get(slug);
  if (!iv || iv.draft || !iv.video.hls) return null;
  const end =
    iv.video.duration ??
    Math.max(...iv.segments.map((s) => s.end), ...iv.cards.map((c) => c.time), 1);
  return {
    slug: iv.slug,
    name: iv.interviewee.name,
    jobtitle: iv.interviewee.jobtitle,
    hls: iv.video.hls,
    start: 0,
    end,
    topicId: null,
    segments: [...iv.segments]
      .sort((a, b) => a.start - b.start)
      .map((s) => ({ start: s.start, end: s.end, topicId: s.topicId })),
    cards: iv.cards.map((c) => ({
      time: c.time,
      title: cards.get(c.cardId)?.title ?? c.cardId,
      id: c.cardId,
    })),
  };
}
