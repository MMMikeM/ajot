import { test, expect, type Page } from "@playwright/test";
import { mockApi, mockData, withLongInbox } from "./helpers/mock-api";

// A task added at the end of a list longer than the screen is scrolled into view, clear of the
// touch input bar, and announced, while the capture input keeps focus for the next one.

test.use({ serviceWorkers: "block" });

const openLongList = async (page: Page) => {
  await mockApi(page, { data: withLongInbox(mockData()) });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const addTask = async (page: Page, title: string) => {
  const input = page.locator("#add-task-input");
  await input.click();
  await input.fill(title);
  await input.press("Enter");
};

/** Where the new row must end up: above the input bar on touch, inside the window on desktop */
const visibleBottom = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>("[data-testid=category-input-chip]")!;
    const touch = getComputedStyle(bar).display !== "none";
    return touch ? bar.parentElement!.getBoundingClientRect().top : window.innerHeight;
  });

test("a task added to a long list scrolls into view and is announced", async ({ page }) => {
  await openLongList(page);
  const title = "Water the basil";
  await addTask(page, title);

  const row = page.locator("[data-task-id]", { hasText: title });
  await expect(row).toHaveCount(1);
  const limit = await visibleBottom(page);
  await expect
    .poll(
      async () => {
        const box = (await row.boundingBox())!;
        return box.y + box.height;
      },
      { message: "the new row's bottom edge clears the input bar or the window's bottom" },
    )
    .toBeLessThanOrEqual(limit);
  expect((await row.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  // The entrance is held until the row is on screen; a hold that never let go would leave it blank
  await expect(row.locator(":scope > div").first()).toHaveCSS("opacity", "1");

  await expect(page.getByRole("status").filter({ hasText: "Added to Inbox" })).toHaveCount(1);
  await expect(page.locator("#add-task-input")).toBeFocused();
});
