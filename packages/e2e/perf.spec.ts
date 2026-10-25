import { test, expect, type Browser } from "@playwright/test";

// Runs against a production build: `pnpm test:e2e:prerender` (playwright.prerender.config.ts)

const DCL_BUDGET_MS = 1000;
const SAMPLES = 3;

/**
 * The fastest of a few loads, each in a fresh context so nothing is cached. A regression slows
 * every load, while a busy machine (the first load of a run, parallel workers) slows only some.
 */
const measure = async (browser: Browser, baseURL: string | undefined, url: string) => {
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const context = await browser.newContext({ ...test.info().project.use, baseURL });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    times.push(
      await page.evaluate(() => {
        const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        return Math.round(entry ? entry.domContentLoadedEventEnd : performance.now());
      }),
    );
    await context.close();
  }
  return Math.min(...times);
};

test.describe("Time to DOMContentLoaded", () => {
  test("/ (empty state)", async ({ browser, baseURL }) => {
    const ms = await measure(browser, baseURL, "/");
    console.log(`  DOMContentLoaded /        → ${ms} ms`);
    expect(ms, `DOMContentLoaded exceeded ${DCL_BUDGET_MS} ms budget`).toBeLessThan(DCL_BUDGET_MS);
  });

  test("/auth", async ({ browser, baseURL }) => {
    const ms = await measure(browser, baseURL, "/auth");
    console.log(`  DOMContentLoaded /auth     → ${ms} ms`);
    expect(ms, `DOMContentLoaded exceeded ${DCL_BUDGET_MS} ms budget`).toBeLessThan(DCL_BUDGET_MS);
  });
});
