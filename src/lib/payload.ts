// What the player needs about the references a set of turns can raise.
//
// Both the page payload and the fetched-on-demand playlists want the same
// shape, and a lock splices new turns into a running film: if their cards
// were not carried alongside them, a name raised after the cut would open
// nothing. So the cards travel with the items, always.

import { cards as allCards, topics } from "./content";
import { safeBody, appearances } from "./cards";
import type { CrossCutItem } from "./crosscut";

export interface CardPayload {
  slug: string;
  body: string;
  subtitle: string | null;
  image: string | null;
  external: string | null;
  location: string | null;
  also: { slug: string; name: string; time: number; topicId: string | null; topicLabel: string | null }[];
}

export function cardsFor(items: CrossCutItem[], base: string): Record<string, CardPayload> {
  const raised = new Set(items.flatMap((i) => i.cards.map((c) => c.title)));
  return Object.fromEntries(
    [...allCards.values()]
      .filter((c) => raised.has(c.title))
      .map((c) => [
        c.title,
        {
          slug: c.slug,
          body: safeBody(c.body),
          subtitle: c.subtitle ?? null,
          image: c.image ? `${base}${c.image}` : null,
          external: c.external ?? null,
          location: c.location ?? null,
          also: appearances(c.slug).map((a) => ({
            slug: a.slug,
            name: a.name,
            time: a.time,
            topicId: a.topicId,
            topicLabel: a.topicId ? (topics.get(a.topicId)?.label ?? a.topicId) : null,
          })),
        },
      ]),
  );
}

/** Every theme that has film, as the player needs to name and colour them. */
export function themeIndex(): Record<string, { label: string; colour: string }> {
  return Object.fromEntries(
    [...topics.values()].map((t) => [t.slug, { label: t.label, colour: t.colour }]),
  );
}
