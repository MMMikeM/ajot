import { test, expect, type Page } from "@playwright/test";
import { taskRow as row } from "./helpers/app";
import { openList } from "./helpers/mock-api";

const hide = (page: Page, hidden: boolean) =>
  page.evaluate(`(() => {
    if (${hidden}) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    } else {
      delete document.hidden;
      delete document.visibilityState;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  })()`);

test("waits while the page is hidden, as when switching apps", async ({ page }) => {
  test.slow();
  await openList(page);
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  const toast = page.locator("[data-toast-undo]", { hasText: "“Pick up dry cleaning” done" });
  await expect(toast).toBeVisible();

  await hide(page, true);
  await page.waitForTimeout(9000);
  await hide(page, false);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});

test("pauses without sending the window a blur or focus of its own", async ({ page }) => {
  await openList(page);
  // As iOS returning to the app: no window focus event, and the document reports no focus
  await page.evaluate(`(() => {
    window.__focusEvents = 0;
    const count = (e) => { if (e.target === window) window.__focusEvents++; };
    window.addEventListener("blur", count, true);
    window.addEventListener("focus", count, true);
    document.hasFocus = () => false;
  })()`);
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  const toast = page.locator("[data-toast-undo]", { hasText: "“Pick up dry cleaning” done" });
  await expect(toast).toBeVisible();
  await hide(page, true);
  await hide(page, false);
  expect(await page.evaluate("window.__focusEvents")).toBe(0);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});

test("stays paused while the page shows but another window has focus", async ({ page }) => {
  // As on Android in split screen, with the other app focused
  test.slow();
  await openList(page);
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  const toast = page.locator("[data-toast-undo]", { hasText: "“Pick up dry cleaning” done" });
  await expect(toast).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await hide(page, true);
  await hide(page, false);
  await page.waitForTimeout(9000);
  await expect(toast).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});
