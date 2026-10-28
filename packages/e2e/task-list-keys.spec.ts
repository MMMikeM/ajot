import { test, expect, type Page } from "@playwright/test";
import { mockApi } from "./helpers/mock-api";

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const activeList = (page: Page) => page.locator('ul[data-flip-key="active"]');

// By its own name: a parent's row also holds its subtasks' checkboxes
const checkboxOf = (page: Page, title: string) =>
  activeList(page).getByRole("checkbox", { name: new RegExp(`^${title}`) });

const focusedRowTitle = (page: Page) =>
  page.evaluate(
    `document.activeElement?.closest("[data-task-id]")?.querySelector('[role="checkbox"]')?.getAttribute("aria-label") ?? null`,
  );

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
  await page.locator("#add-task-input").focus();
});

test("the list is one tab stop: Tab walks the first row's controls, then leaves", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await expect(checkboxOf(page, "Book flights")).toBeFocused();

  const rowsVisited = new Set<unknown>();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const inList = await activeList(page).evaluate((list) => list.contains(document.activeElement));
    if (!inList) break;
    rowsVisited.add(await focusedRowTitle(page));
  }

  expect([...rowsVisited]).toEqual([expect.stringMatching(/^Book flights/)]);
  await expect(page.getByRole("button", { name: /^Done \(/ })).toBeFocused();
});

test("Up and Down, or j and k, move between rows, subtasks included", async ({ page }) => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await expect(checkboxOf(page, "Compare Tuesday and Wednesday fares")).toBeFocused();
  await page.keyboard.press("j");
  await expect(checkboxOf(page, "Write a thank-you note to Anna")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(checkboxOf(page, "Compare Tuesday and Wednesday fares")).toBeFocused();
  await page.keyboard.press("k");
  await expect(checkboxOf(page, "Book flights")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(checkboxOf(page, "Book flights")).toBeFocused();
  await page.keyboard.press("End");
  await expect(checkboxOf(page, "Pick a restaurant for Friday")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(checkboxOf(page, "Book flights")).toBeFocused();
});

test("Tab returns to the row the arrows left off on", async ({ page }) => {
  await page.keyboard.press("Tab");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await expect(checkboxOf(page, "Call the plumber")).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#add-task-input")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(checkboxOf(page, "Call the plumber")).toBeFocused();

  // Into that row's own controls, not the next row's
  await page.keyboard.press("Tab");
  await expect(row(page, "Call the plumber").getByRole("button").first()).toBeFocused();
});

test("Enter on a row's checkbox opens the task", async ({ page }) => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  const thankYou = checkboxOf(page, "Write a thank-you note to Anna");
  await expect(thankYou).toBeFocused();
  const taskId = await row(page, "Write a thank-you note to Anna").getAttribute("data-task-id");
  await page.keyboard.press("Enter");
  const sheet = page.locator('[data-slot="drawer-content"]');
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/task/${taskId}$`));
  await expect(sheet.getByRole("checkbox").first()).not.toBeChecked();
});

test("a row that leaves hands the tab stop to the first row", async ({ page }) => {
  await checkboxOf(page, "Pick up dry cleaning").click();
  await expect(row(page, "Pick up dry cleaning")).toHaveCount(0, { timeout: 2000 });

  await page.keyboard.press("Shift");
  await page.locator("#add-task-input").focus();
  await page.keyboard.press("Tab");
  await expect(checkboxOf(page, "Book flights")).toBeFocused();
});

test("j and k typed into a new subtask stay in the field", async ({ page }) => {
  await page.keyboard.press("Tab");
  await row(page, "Book flights").getByRole("button", { name: "Add subtask" }).first().focus();
  await page.keyboard.press("Enter");
  const field = page.getByPlaceholder("New subtask");
  await expect(field).toBeFocused();
  await page.keyboard.type("jk");
  await expect(field).toHaveValue("jk");
  await expect(field).toBeFocused();
});

test("/ still opens search from a focused row", async ({ page }) => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("/");
  await page.waitForURL("**/search");
});
