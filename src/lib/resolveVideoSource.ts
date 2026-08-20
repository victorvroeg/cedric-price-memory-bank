import type { Interview } from "./content";
import { DEV_FALLBACK_STREAM } from "../config";

export type VideoSource =
  | { kind: "hls"; url: string; placeholder: boolean }
  | null;

// The single seam between the archive and whichever host serves its video.
// Re-pointing the archive at a new host means changing interview.video.hls
// (data) or this function (code) — nothing else. See RESURRECT.md.
export function resolveVideoSource(interview: Interview): VideoSource {
  if (interview.video.hls) {
    return { kind: "hls", url: interview.video.hls, placeholder: false };
  }
  if (DEV_FALLBACK_STREAM) {
    return { kind: "hls", url: DEV_FALLBACK_STREAM, placeholder: true };
  }
  return null; // the site still renders: topics, segments, cards, transcript
}
