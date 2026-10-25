import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { API_PORT, PREVIEW_PORT } from "./helpers/stack";

// What runs with no page open: the Chrome extension's background and the PWA's service worker,
// against the built extension and the production build. Both run in Chromium, so one project.
export default defineConfig({
  ...base,
  testMatch: ["extension.spec.ts", "pwa-background.spec.ts"],
  testIgnore: undefined,
  projects: base.projects?.filter((project) => project.name === "desktop"),
  webServer: [
    ...(Array.isArray(base.webServer) ? base.webServer : []),
    {
      // exec, so stopping the server stops vp itself rather than a shell around it
      command: `exec node_modules/.bin/vp preview --port ${PREVIEW_PORT} --strictPort`,
      cwd: "../client",
      url: `http://localhost:${PREVIEW_PORT}`,
      // The preview server proxies /api as the dev server does
      env: { ...process.env, SERVER_URL: `http://localhost:${API_PORT}` } as Record<string, string>,
      reuseExistingServer: false,
    },
  ],
});
