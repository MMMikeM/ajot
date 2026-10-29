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

test("without a canvas a worker can draw on, the CSS desk stays", async ({ page }) => {
  await page.addInitScript(() => {
    delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
  });
  await page.goto("/");
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(500);
  expect(await counts(page)).toEqual({ canvas: 0, css: 3 });
});

test("without WebGL in the worker, the CSS desk shows through its empty canvas", async ({
  page,
}) => {
  await page.route("**/desk-worker-*.js", async (route) => {
    const script = await (await route.fetch()).text();
    await route.fulfill({
      body: `OffscreenCanvas.prototype.getContext = () => null;\n${script}`,
      contentType: "text/javascript",
    });
  });
  await page.goto("/");
  await page.waitForSelector("[data-task-id]");
  await page.waitForTimeout(500);
  expect(await counts(page)).toEqual({ canvas: 1, css: 3 });
});
