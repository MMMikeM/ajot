import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";
import type { Page } from "@playwright/test";

// Needs the build's service worker, so it runs with the prerender suite, which allows it

const openControlled = async (page: Page) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
};

// What a newer deploy's worker answers when the page asks its build
const newerWorkerAnswers = (page: Page) =>
  page.evaluate(() =>
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "BUILD_VERSION", version: "a-newer-build" } }),
    ),
  );

const updateBanner = (page: Page) => page.getByText("A new version of Ajot is ready");

test("a worker of the page's own build taking over offers nothing", async ({ page }) => {
  await openControlled(page);
  // The real worker answers with this build's version
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await page.waitForTimeout(500);
  await expect(updateBanner(page)).toHaveCount(0);
});

test("a newer build asks for a reload, which waits for the user and can't be dismissed", async ({
  page,
}) => {
  await openControlled(page);
  let loads = 0;
  page.on("load", () => loads++);
  await newerWorkerAnswers(page);
  await expect(updateBanner(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(loads, "reloaded without being asked").toBe(0);
  await page.keyboard.press("Escape");
  await expect(updateBanner(page)).toBeVisible();

  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload" }).click();
  await reloaded;
});

test("a newer build reloads a page that's been put away", async ({ page }) => {
  await openControlled(page);
  await newerWorkerAnswers(page);
  await expect(updateBanner(page)).toBeVisible();

  const reloaded = page.waitForEvent("load");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await reloaded;
});
