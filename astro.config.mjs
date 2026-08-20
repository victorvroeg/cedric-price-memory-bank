import { defineConfig } from "astro/config";

// Static output, no adapters, no integrations. The built site is plain files
// with no runtime dependency — see RESURRECT.md.
//
// DEPLOY_TARGET=pages builds for the GitHub Pages staging URL, which serves
// from a subpath. The production build (no env var) assumes the real domain
// at the root.
const pages = process.env.DEPLOY_TARGET === "pages";

export default defineConfig({
  output: "static",
  site: pages ? "https://victorvroeg.github.io" : "https://www.cedricprice.com",
  base: pages ? "/cedric-price-memory-bank" : undefined,
});
