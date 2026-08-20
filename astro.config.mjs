import { defineConfig } from "astro/config";

// Static output, no adapters, no integrations. The built site is plain files
// with no runtime dependency — see RESURRECT.md.
export default defineConfig({
  output: "static",
  site: "https://www.cedricprice.com",
});
