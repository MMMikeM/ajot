import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

const tick = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first().getByRole("checkbox").first().click();

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
});

test.describe("toast stacking", () => {
  test("single toast appears and is visible", async ({ page }) => {
    await tick(page, "Renew passport");

    const toast = page.locator("[data-toast-undo]").first();
    await expect(toast).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: ".filmstrip/toast-single.png", fullPage: false });
  });

  test("two stacked toasts are visible simultaneously", async ({ page }) => {
    await tick(page, "Renew passport");
    await tick(page, "Pick up dry cleaning");

    const toasts = page.locator("[data-toast-undo]");
    await expect(toasts).toHaveCount(2, { timeout: 3000 });

    await page.screenshot({ path: ".filmstrip/toast-two-stacked.png", fullPage: false });
  });

  test("three stacked toasts show peek-behind effect", async ({ page }) => {
    await tick(page, "Renew passport");
    await tick(page, "Pick up dry cleaning");
    await tick(page, "Call the plumber about the kitchen tap");

    const toasts = page.locator("[data-toast-undo]");
    await expect(toasts).toHaveCount(3, { timeout: 3000 });

    await page.screenshot({ path: ".filmstrip/toast-three-stacked.png", fullPage: false });

    // Close-up clipped to the toast stack so the peek effect is visible
    const clip = await page.evaluate(() => {
      const els = document.querySelectorAll("[data-toast-undo]");
      let minY = Infinity,
        maxY = -Infinity,
        minX = Infinity,
        maxX = -Infinity;
      els.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        minY = Math.min(minY, r.top);
        maxY = Math.max(maxY, r.bottom);
        minX = Math.min(minX, r.left);
        maxX = Math.max(maxX, r.right);
      });
      return {
        x: Math.max(0, minX - 30),
        y: Math.max(0, minY - 30),
        width: maxX - minX + 60,
        height: maxY - minY + 50,
      };
    });
    await page.screenshot({ path: ".filmstrip/toast-three-stacked-closeup.png", clip });
  });

  test("each toast names its task, so each Undo says what it brings back", async ({ page }) => {
    await tick(page, "Renew passport");
    await tick(page, "Pick up dry cleaning");

    const toasts = page.locator("[data-toast-undo]");
    await expect(toasts).toHaveCount(2);
    await expect(toasts.filter({ hasText: "“Renew passport” done" })).toHaveCount(1);
    await expect(toasts.filter({ hasText: "“Pick up dry cleaning” done" })).toHaveCount(1);
  });

  test("stacking moves toasts without resizing them", async ({ page }) => {
    await tick(page, "Renew passport");
    await tick(page, "Pick up dry cleaning");
    await tick(page, "Call the plumber about the kitchen tap");
    const toasts = page.locator("[data-toast-undo]");
    await expect(toasts).toHaveCount(3);
    // Their own transitions only: each one's countdown bar animates for seconds
    await expect
      .poll(() => toasts.evaluateAll((els) => els.every((el) => el.getAnimations().length === 0)))
      .toBe(true);

    // Each keeps the height Base UI measured for it, and the ones behind peek out above
    const boxes = await toasts.evaluateAll((els) =>
      els.map((el) => ({
        index: Number(getComputedStyle(el).getPropertyValue("--toast-index")),
        height: (el as HTMLElement).offsetHeight,
        natural: parseFloat(getComputedStyle(el).getPropertyValue("--toast-height")),
        top: el.getBoundingClientRect().top,
      })),
    );
    for (const box of boxes) expect(box.height).toBe(box.natural);
    const byIndex = boxes.sort((a, b) => a.index - b.index);
    expect(byIndex[1].top).toBeLessThan(byIndex[0].top);
    expect(byIndex[2].top).toBeLessThan(byIndex[1].top);
  });
});
