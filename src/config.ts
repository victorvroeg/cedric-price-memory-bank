// Site-level configuration, kept in one visible place.

// Until films are transcoded onto the streaming host (M3), interviews have
// video.hls = null. During development the player falls back to this public
// test stream so the projection treatment and player can be seen working.
// Set to null to see the degraded (video-less) state instead.
export const DEV_FALLBACK_STREAM: string | null =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

// The interview the front page opens with while the archive UI is M1-minimal.
export const DEMO_INTERVIEW = "jeremy-melvin";
