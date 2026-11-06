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
