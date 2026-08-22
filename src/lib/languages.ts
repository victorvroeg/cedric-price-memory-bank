// The languages the captions are offered in.
//
// English is the archive's own language: it is what was spoken, and it is
// the only transcript with timings of its own. Every translation reuses the
// English cue times, so a translated caption is always on the same frame as
// the sentence it translates.

export interface Language {
  code: string;
  /** what the picker shows, in that language */
  label: string;
  /** what an English-speaking editor calls it, for the review tool */
  english: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", label: "English", english: "English" },
  { code: "es", label: "Español", english: "Spanish" },
  { code: "fr", label: "Français", english: "French" },
  { code: "pt", label: "Português", english: "Portuguese" },
  { code: "de", label: "Deutsch", english: "German" },
  { code: "ja", label: "日本語", english: "Japanese" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/** the key a translated transcript is filed under: "brett-steele.ja" */
export const transcriptKey = (slug: string, lang: string): string =>
  lang === "en" ? slug : `${slug}.${lang}`;
