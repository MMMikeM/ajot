import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const PORT = 4174;

// Specs that need the prerendered index.html, which only a production build has
export default defineConfig({
  ...base,
  testMatch: "skeleton.spec.ts",
  testIgnore: undefined,
  // The skeleton needs no accounts, and the preview server has no API to make them on
  globalSetup: undefined,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    // exec, so stopping the server stops vp itself rather than a shell around it
    command: `exec node_modules/.bin/vp preview --port ${PORT} --strictPort`,
    cwd: "../client",
    url: `http://localhost:${PORT}`,
    // A server already on this port could be serving an older build
    reuseExistingServer: false,
  },
});
