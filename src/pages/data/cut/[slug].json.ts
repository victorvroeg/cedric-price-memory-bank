// A theme's cross-cut, fetched at the moment somebody locks it.
//
// This is not on the page because a lock can happen anywhere: on any film,
// on any of its themes. Shipping every reachable playlist inside every page
// would put a hundred kilobytes of other people's turns into a page most
// visitors never lock anything on. Fetching it costs one request, made while
// the current answer is still being spoken, so it lands before the cut.

import type { APIRoute } from "astro";
import { topics } from "../../../lib/content";
import { crossCut } from "../../../lib/crosscut";
import { cardsFor } from "../../../lib/payload";

export function getStaticPaths() {
  return [...topics.keys()].map((slug) => ({ params: { slug } }));
}

export const GET: APIRoute = ({ params }) => {
  const slug = params.slug!;
  const t = topics.get(slug);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { playable } = crossCut(slug);
  return new Response(
    JSON.stringify({
      slug,
      label: t?.label ?? slug,
      colour: t?.colour ?? "#666",
      items: playable,
      cards: cardsFor(playable, base),
    }),
    { headers: { "content-type": "application/json" } },
  );
};
