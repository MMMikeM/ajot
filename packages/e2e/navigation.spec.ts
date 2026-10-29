import { test, expect } from "./fixtures";
import { mockApi, openList } from "./helpers/mock-api";

test("an empty Inbox stays open and listed", async ({ page }) => {
  const data = await mockApi(page);
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: data.tasks.filter((t) => t.categoryId) })
      : route.fallback(),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("type something")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);

  await page.getByRole("button", { name: /^Work/ }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "Work" })).toHaveCount(1);
  await page
    .getByRole("button", { name: /^Inbox/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
});

test("the list title renders once", async ({ page }) => {
  await openList(page);
  await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
  await expect(page.getByTestId("category-nav-trigger")).toHaveCount(0);
});

test("the column stays put between the list and People", async ({ page }) => {
  await openList(page);
  const column = page.locator("main").locator("..");
  const listX = (await column.boundingBox())!.x;

  await page.getByTestId("category-sidebar").getByRole("link", { name: "People" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByTestId("category-sidebar")).toBeVisible();
  expect((await column.boundingBox())!.x).toBe(listX);
});

test("the sidebar shows open-task counts", async ({ page }) => {
  await openList(page);
  const sidebar = page.getByTestId("category-sidebar");
  await expect(sidebar.getByRole("button", { name: /^Inbox/ })).toContainText("7");
  await expect(sidebar.getByRole("button", { name: /^Work/ })).toContainText("2");
});

test("your shared lists read differently from lists shared with you", async ({ page }) => {
  await openList(page);
  const sharedWithMe = page.getByRole("group", { name: "Shared with me" });
  await expect(sharedWithMe.getByRole("button", { name: /^Groceries/ })).toBeVisible();
  await expect(sharedWithMe.getByRole("button", { name: /^Home/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Home Shared with Sam Okafor/ }).first(),
  ).toBeVisible();
});

test("narrow pointer windows swap the sidebar for the list-title sheet", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await openList(page);

  await expect(page.getByTestId("category-sidebar")).toHaveCount(0);
  await page.getByTestId("category-nav-trigger").click();
  await expect(page.getByRole("button", { name: "Add list" })).toBeVisible();
});
