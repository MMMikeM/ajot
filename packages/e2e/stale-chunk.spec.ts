import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

// Vite only reports a failed chunk (vite:preloadError) from a production build, so this runs with
// the prerender suite against `vp preview`
test.use({ serviceWorkers: "block" });

test("a chunk gone after a deploy reloads the page once, and the new build loads", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the People link is in the desktop sidebar");
  await mockApi(page);
  // The first request stands in for a chunk an earlier deploy removed; after the reload it's back
  let removed = 0;
  await page.route(/\/assets\/people\.lazy-[^/]+\.js$/, (route) => {
    if (removed > 0) return route.fallback();
    removed++;
    return route.fulfill({ status: 404, body: "" });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  const reloaded = page.waitForEvent("load");
  await page.getByRole("link", { name: "People" }).click();
  await reloaded;

  expect(removed).toBe(1);
  if (!page.url().includes("people")) await page.getByRole("link", { name: "People" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("a chunk that stays missing doesn't reload in a loop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the People link is in the desktop sidebar");
  await mockApi(page);
  await page.route(/\/assets\/people\.lazy-[^/]+\.js$/, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  let loads = 0;
  page.on("load", () => loads++);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  await page.getByRole("link", { name: "People" }).click();
  await page.waitForTimeout(1500);
  if (!page.url().includes("people")) await page.getByRole("link", { name: "People" }).click();
  await page.waitForTimeout(1500);

  // The first load, and at most the one reload
  expect(loads).toBeLessThanOrEqual(2);
});
