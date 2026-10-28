import { test, expect, type Page } from "@playwright/test";
import { taskRow as row } from "./helpers/app";
import { openList } from "./helpers/mock-api";

// The server refuses to delete a task for anyone but its owner, or the owner of its parent

// Hidden too: the hover buttons sit at opacity 0
const deleteControls = (page: Page, title: string) =>
  row(page, title).getByRole("button", { name: /^Delete/, includeHidden: true });

const openDetail = async (page: Page, title: string) => {
  await row(page, title).getByRole("button", { name: title, exact: true }).click();
  const detail = page.getByRole("dialog", { name: title });
  await expect(detail).toBeVisible();
  return detail.getByRole("button", { name: "Delete task" });
};

test("your own task offers delete", async ({ page }) => {
  await openList(page);
  await expect(deleteControls(page, "Pick up dry cleaning")).not.toHaveCount(0);
  await expect(await openDetail(page, "Pick up dry cleaning")).toHaveCount(1);
});

test("a task shared with you offers no delete", async ({ page }) => {
  await openList(page);
  await expect(deleteControls(page, "Pick a restaurant for Friday")).toHaveCount(0);
  await expect(await openDetail(page, "Pick a restaurant for Friday")).toHaveCount(0);
});

test("a collaborator's task in a list shared with you offers no delete", async ({ page }) => {
  await openList(page);
  await page
    .getByRole("group", { name: "Shared with me" })
    .getByRole("button", { name: /^Groceries/ })
    .click();
  await expect(deleteControls(page, "Eggs")).toHaveCount(0);
  await expect(await openDetail(page, "Eggs")).toHaveCount(0);
});
