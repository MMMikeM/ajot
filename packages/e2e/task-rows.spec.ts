import { test, expect } from "./fixtures";
import { taskRow as row } from "./helpers/app";
import { mockData, openList } from "./helpers/mock-api";

test("a right-to-left title reads right to left wherever it shows", async ({ page }) => {
  const hebrew = "לקנות חלב ולחם לשבת";
  const data = mockData();
  data.tasks.find((t) => t.title === "Pick up dry cleaning")!.title = hebrew;
  data.categories.find((c) => c.id === "c-home")!.name = "בית";
  await openList(page, { data });

  const isRtl = (el: Element) => el.matches(":dir(rtl)");
  const title = row(page, hebrew).getByText(hebrew, { exact: true });
  expect(await title.evaluate(isRtl)).toBe(true);
  expect(await row(page, "Renew passport").getByText("Renew passport").evaluate(isRtl)).toBe(false);
  expect(await page.getByTestId("category-sidebar").getByText("בית").evaluate(isRtl)).toBe(true);

  await title.click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  expect(await sheet.getByRole("textbox", { name: "Title" }).evaluate(isRtl)).toBe(true);
});

test("the capture input keeps its name once something is typed", async ({ page }) => {
  await openList(page);
  const input = page.getByRole("textbox", { name: "New task" });
  await input.fill("Water the plants");
  await expect(input).toHaveAccessibleName("New task");
});

test("hover actions take no space at rest and appear on hover", async ({ page }) => {
  await openList(page);
  const target = row(page, "Pick up dry cleaning");
  const actions = target.getByRole("button", { name: "Delete task" }).locator("xpath=..");

  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS("opacity", "0");

  // The title runs to the row's padding instead of stopping short of a reserved gutter
  const titleBox = await target
    .getByRole("button", { name: "Pick up dry cleaning", exact: true })
    .boundingBox();
  const rowBox = await target.locator(".group\\/task").first().boundingBox();
  expect(rowBox!.x + rowBox!.width - (titleBox!.x + titleBox!.width)).toBeLessThan(12);

  await target.hover();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("a ticked task holds in place before moving to Done", async ({ page }) => {
  await openList(page);
  const target = row(page, "Pick up dry cleaning");
  const checkbox = target.getByRole("checkbox");

  await checkbox.click();
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await expect(target).toBeVisible();

  await expect(page.locator("[data-task-id]", { hasText: "Pick up dry cleaning" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /done \(3\)/i })).toBeVisible();
});

test("ticking again during the hold cancels the move", async ({ page }) => {
  await openList(page);
  const target = row(page, "Renew passport");
  const checkbox = target.getByRole("checkbox");

  await checkbox.click();
  await checkbox.click();
  await page.waitForTimeout(700);

  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(target).toBeVisible();
});

test("avatars use first and last initials", async ({ page }) => {
  await openList(page);
  await expect(
    row(page, "Sort out the car insurance").getByTitle("Assigned to Sam Okafor"),
  ).toHaveText(/^SO/);
  await expect(
    row(page, "Pick a restaurant for Friday").getByTitle("Sarah Murray's task"),
  ).toHaveText(/^SM/);
});

test("only a task added now slides in; the loaded list appears at once", async ({ page }) => {
  await openList(page);
  const entering = page.locator('[data-task-id] [class*="task-enter"]');
  await expect(entering).toHaveCount(0);

  await page.fill("#add-task-input", "Water the plants");
  await page.keyboard.press("Enter");
  await expect(row(page, "Water the plants").locator('[class*="task-enter"]')).toHaveCount(1);
  await expect(entering).toHaveCount(1);
});
