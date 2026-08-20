// Site-level configuration, kept in one visible place.

// Interviews without a video.hls value render the degraded (video-less)
// state. A public test stream can be set here to exercise the player
// without real footage; with real films arriving, it stays off.
export const DEV_FALLBACK_STREAM: string | null = null;

// The interview the front page opens with while the archive UI is M1-minimal.
export const DEMO_INTERVIEW = "will-alsop";
