import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { mockData, openList, withLongInbox } from "./helpers/mock-api";

const addTask = async (page: Page, title: string) => {
  const input = page.locator("#add-task-input");
  await input.click();
  await input.fill(title);
  await input.press("Enter");
};

test("a task added to a long list on the phone scrolls into view clear of the input bar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the input bar sits below the list on touch only");
  await openList(page, { data: withLongInbox(mockData()) });
  await addTask(page, "Water the basil");

  const row = page.locator("[data-task-id]", { hasText: "Water the basil" });
  const barTop = await page
    .getByTestId("category-input-chip")
    .evaluate((chip) => chip.parentElement!.getBoundingClientRect().top);
  await expect
    .poll(async () => {
      const box = (await row.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(barTop);
  expect((await row.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await expect(page.locator("#add-task-input")).toBeFocused();
});

// The add field is at the top of a page the window scrolls, so following the task would take it
// off screen
test("a task added on desktop leaves the page where it is", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop layout");
  await openList(page, { data: withLongInbox(mockData()) });
  await addTask(page, "Water the basil");

  await expect(page.locator("[data-task-id]", { hasText: "Water the basil" })).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("#add-task-input")).toBeInViewport();
});

test("each add is announced with the list it went to", async ({ page }) => {
  await openList(page, { data: withLongInbox(mockData()) });
  await addTask(page, "Water the basil");
  await expect(page.getByRole("status").filter({ hasText: "Added to Inbox" })).toHaveCount(1);
  await addTask(page, "Repot the fern");
  await expect(page.getByRole("status").filter({ hasText: "Added to Inbox" })).toHaveCount(1);
  await expect(page.locator("#add-task-input")).toBeFocused();
});
