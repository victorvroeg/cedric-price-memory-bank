// One interview as a single turn, fetched when somebody stops following a
// theme and stays with the person who was speaking.

import type { APIRoute } from "astro";
import { interviews } from "../../../lib/content";
import { wholeFilm } from "../../../lib/crosscut";
import { cardsFor } from "../../../lib/payload";

export function getStaticPaths() {
  return [...interviews.keys()].map((slug) => ({ params: { slug } }));
}

export const GET: APIRoute = ({ params }) => {
  const slug = params.slug!;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const item = wholeFilm(slug);
  const items = item ? [item] : [];
  return new Response(
    JSON.stringify({ slug, items, cards: cardsFor(items, base) }),
    { headers: { "content-type": "application/json" } },
  );
};
