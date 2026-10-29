import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const PORT = 4174;

export default defineConfig({
  ...base,
  testMatch: ["skeleton.spec.ts", "stale-chunk.spec.ts", "perf.spec.ts", "update-reload.spec.ts"],
  testIgnore: undefined,
  // These need no accounts, and this preview server has no API to make them on
  globalSetup: undefined,
  use: { ...base.use, baseURL: `http://localhost:${PORT}`, serviceWorkers: "allow" },
  // Both viewports, rather than the main suite's touch specs on mobile
  projects: base.projects?.map((project) => ({ ...project, testMatch: undefined })),
  webServer: {
    // exec, so stopping the server stops vp itself rather than a shell around it
    command: `exec node_modules/.bin/vp preview --port ${PORT} --strictPort`,
    cwd: "../client",
    url: `http://localhost:${PORT}`,
    // A server already on this port could be serving an older build
    reuseExistingServer: false,
  },
});
