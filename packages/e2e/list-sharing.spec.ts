import { test, expect, type Page } from "./fixtures";
import { openList } from "./helpers/mock-api";

const openShareSheet = async (page: Page) => {
  const pill = page
    .getByTestId("category-sidebar")
    .locator(".group\\/pill")
    .filter({ hasText: "Home" });
  await pill.hover();
  await pill.getByRole("button", { name: "List options" }).click();
  await page.getByTestId("category-share-btn").click();
  return page.getByRole("dialog", { name: "Share list" });
};

test("choosing a contact shares the list with them, and Undo removes them", async ({ page }) => {
  await openList(page);
  const sheet = await openShareSheet(page);

  await expect(sheet.getByText("Sam Okafor", { exact: true })).toBeVisible();
  const added = page.waitForRequest(
    (req) => req.url().endsWith("/api/categories/c-home/collaborators") && req.method() === "POST",
  );
  await sheet.getByRole("combobox", { name: "Add someone" }).click();
  await page.getByRole("option", { name: /^Sarah Murray/ }).click();
  expect((await added).postDataJSON()).toEqual({ username: "sarah" });

  const toast = page.locator("[data-toast-undo]", { hasText: "Shared with Sarah Murray" });
  await expect(toast).toBeVisible();
  const removed = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/categories/c-home/collaborators/u-sarah") &&
      req.method() === "DELETE",
  );
  await toast.getByRole("button", { name: "Undo" }).click();
  await removed;
  await expect(sheet).toBeVisible();
  // Undoing the share is itself the undo: it offers no Undo of its own
  await expect(page.locator("[data-toast-undo]", { hasText: "Removed" })).toHaveCount(0);
});

test("removing someone offers Undo, which puts them back", async ({ page }) => {
  await openList(page);
  const sheet = await openShareSheet(page);

  const sam = sheet.getByText("Sam Okafor", { exact: true });
  await sam.hover();
  await sheet.getByRole("button", { name: "Remove" }).click();
  await expect(sam).toHaveCount(0);

  const toast = page.locator("[data-toast-undo]", { hasText: "Removed Sam Okafor" });
  const restored = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/categories/c-home/collaborators/u-sam/restore") &&
      req.method() === "POST",
  );
  await toast.getByRole("button", { name: "Undo" }).click();
  await restored;
  await expect(sam).toBeVisible();
  await expect(sheet).toBeVisible();
});
