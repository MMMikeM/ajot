import { defineConfig, devices } from "@playwright/test";
import { API_PORT, BASE_URL, CLIENT_PORT } from "./helpers/stack";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // Runs against a production build: playwright.prerender.config.ts
  testIgnore: ["skeleton.spec.ts", "stale-chunk.spec.ts"],
  outputDir: ".output",
  snapshotDir: ".snapshots",

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The GitHub runner has 4 cores; each worker has its own accounts, so they don't collide
  workers: process.env.CI ? 4 : undefined,

  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],

  // Without BASE_URL the suite brings its own stack, with an empty database each run
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          // exec, so stopping it stops the script and its exit handler removes the container
          command: "exec node_modules/.bin/tsx api-stack.ts",
          url: `http://localhost:${API_PORT}/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          // Playwright otherwise sends SIGKILL, which skips the script removing its container
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          stdout: "pipe",
        },
        {
          command: `exec node_modules/.bin/vp dev --port ${CLIENT_PORT} --strictPort`,
          cwd: "../client",
          url: BASE_URL,
          env: { ...process.env, SERVER_URL: `http://localhost:${API_PORT}` } as Record<
            string,
            string
          >,
          reuseExistingServer: false,
        },
      ],
  globalSetup: "./global-setup.ts",

  use: {
    baseURL: BASE_URL,
    colorScheme: "dark",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 14"],
        // The iPhone 14 preset defaults to WebKit, which would need installing
        browserName: "chromium",
      },
    },
  ],
});
