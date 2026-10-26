import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

const counts = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ({
    canvas: document.querySelectorAll("canvas[data-desk]").length,
    css: document.querySelectorAll("[data-desk-css]").length,
  }));

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("the desk moves to WebGL once the page is up", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("[data-task-id]");
  await expect.poll(() => counts(page)).toEqual({ canvas: 1, css: 0 });
});

test("without WebGL the CSS desk stays", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/");
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(500);
  expect(await counts(page)).toEqual({ canvas: 0, css: 3 });
});
