// Typed access to the content/ tree. All JSON is imported at build time;
// the deployed site carries the data inside its static bundle.

export interface Segment {
  start: number;
  end: number;
  topicId: string;
}

export interface CardPlacement {
  time: number;
  cardId: string;
}

export interface Interview {
  slug: string;
  title: string;
  interviewee: { name: string; jobtitle: string };
  recorded: string;
  /** true until a human has approved the drafted topic map — drafts are
   *  reachable at their own URL for review but stay out of the archive. */
  draft?: boolean;
  video: {
    hls: string | null;
    duration: number | null;
    legacy: { vimeoId: string | null; wpSlug: string };
  };
  segments: Segment[];
  cards: CardPlacement[];
}

export interface Topic {
  slug: string;
  label: string;
  description: string;
  colour: string;
}

export interface Card {
  slug: string;
  title: string;
  body: string;
  image: string | null;
  /** from the studio's INFO BLOCKS record, which the 2014 web copy lost */
  subtitle?: string | null;
  external?: string | null;
  location?: string | null;
}

function loadDir<T>(glob: Record<string, unknown>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, mod] of Object.entries(glob)) {
    const slug = path.split("/").pop()!.replace(/\.json$/, "");
    const data = (mod as { default: object }).default ?? mod;
    out.set(slug, { slug, ...data } as T);
  }
  return out;
}

export const interviews = loadDir<Interview>(
  import.meta.glob("../../content/interviews/*.json", { eager: true }),
);
export const topics = loadDir<Topic>(
  import.meta.glob("../../content/topics/*.json", { eager: true }),
);
export const cards = loadDir<Card>(
  import.meta.glob("../../content/cards/*.json", { eager: true }),
);

export const colofon = (
  Object.values(
    import.meta.glob("../../content/pages/colofon.json", { eager: true }),
  )[0] as { default: { title: string; body: string } }
).default;

export const intro = (
  Object.values(
    import.meta.glob("../../content/pages/intro.json", { eager: true }),
  )[0] as {
    default: { title: string; video: { hls: string | null; duration: number } };
  }
).default;
