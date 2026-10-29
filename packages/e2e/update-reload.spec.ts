import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";
import type { Page } from "@playwright/test";

// Needs the build's service worker, so it runs with the prerender suite, which allows it. A new
// deploy's worker taking over is stood in for by the event it fires on the page.

const openControlled = async (page: Page) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");
  // The first worker claiming the page fires the same event, which mustn't reload it
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
};

const newWorkerTakesOver = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));

test("a page left on the list reloads as soon as a new build takes over", async ({ page }) => {
  await openControlled(page);
  let loads = 0;
  page.on("load", () => loads++);
  await page.waitForTimeout(500);
  expect(loads, "the first worker's claim reloaded the page").toBe(0);

  const reloaded = page.waitForEvent("load");
  await newWorkerTakesOver(page);
  await reloaded;
});

test("text being typed holds the reload until the field is empty", async ({ page }) => {
  await openControlled(page);
  const input = page.getByPlaceholder("What needs doing?");
  await input.fill("half a thought");
  let loads = 0;
  page.on("load", () => loads++);

  await newWorkerTakesOver(page);
  await page.waitForTimeout(2500);
  expect(loads, "reloaded with text in the capture input").toBe(0);
  await expect(input).toHaveValue("half a thought");

  const reloaded = page.waitForEvent("load");
  await input.fill("");
  await reloaded;
});
