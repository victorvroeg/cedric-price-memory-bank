import { interviews, cards, type Card } from "./content";
import { published } from "./crosscut";

export interface Appearance {
  slug: string;      // interview
  name: string;
  time: number;
  topicId: string | null;
}

/** Every moment a card is raised, across the archive. */
export function appearances(cardId: string): Appearance[] {
  const out: Appearance[] = [];
  for (const iv of published()) {
    for (const c of iv.cards) {
      if (c.cardId !== cardId) continue;
      const seg = iv.segments.find((s) => c.time >= s.start && c.time < s.end);
      out.push({ slug: iv.slug, name: iv.interviewee.name, time: c.time, topicId: seg?.topicId ?? null });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.time - b.time);
}

/** Cards that are actually raised somewhere, with how often. */
export function raisedCards(): { card: Card; count: number }[] {
  const counts = new Map<string, number>();
  for (const iv of published())
    for (const c of iv.cards) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ card: cards.get(id)!, count }))
    .filter((r) => r.card)
    .sort((a, b) => a.card.title.localeCompare(b.card.title));
}

/**
 * The 2014 archive died of mixed content: an https page whose calls were all
 * http, blocked before they left the browser. These card bodies are full of
 * http:// links. Upgrade them, and send them off safely.
 */
export function safeBody(html: string): string {
  return html
    .replace(/http:\/\//g, "https://")
    .replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}

export { interviews };
