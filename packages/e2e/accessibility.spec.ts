import { test, expect } from "@playwright/test";
import { taskRow as row } from "./helpers/app";
import { expectNoAxeViolations } from "./helpers/axe";
import { mockApi, openList } from "./helpers/mock-api";

test("task list", async ({ page }) => {
  await openList(page);
  await expectNoAxeViolations(page);
});

test("task detail sheet", async ({ page }) => {
  await openList(page);
  await row(page, "Book flights")
    .getByRole("button", { name: /^Book flights/ })
    .click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
  await expectNoAxeViolations(page);
});

test("category navigation", async ({ page }) => {
  await openList(page);
  const pill = page
    .getByTestId("category-sidebar")
    .locator(".group\\/pill")
    .filter({ hasText: "Work" });
  await pill.hover();
  await pill.getByRole("button", { name: "List options" }).click();
  await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
  await expectNoAxeViolations(page);
});

test("⌘Z / Ctrl+Z reaches a toast's Undo from inside the sheet", async ({ page }) => {
  await openList(page);
  await row(page, "Book flights")
    .getByRole("button", { name: /^Book flights/ })
    .click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  const subtask = sheet.getByRole("checkbox", { name: "Compare Tuesday and Wednesday fares" });
  await subtask.click();
  await expect(subtask).toBeChecked();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveAttribute(
    "aria-keyshortcuts",
    /Control\+Z/,
  );

  await page.keyboard.press("ControlOrMeta+z");
  await expect(subtask).not.toBeChecked();
  await expect(page.locator("[data-toast-undo]")).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

test("the sheet's Close shows on keyboard focus and closes it", async ({ page }) => {
  await openList(page);
  await row(page, "Book flights")
    .getByRole("button", { name: /^Book flights/ })
    .click();
  const sheet = page.locator('[data-slot="drawer-content"]');
  const close = sheet.getByRole("button", { name: "Close" });
  expect((await close.boundingBox())?.width).toBeLessThanOrEqual(1);
  // The sheet's last control before Close
  await sheet.getByRole("button", { name: "Add a note" }).focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect((await close.boundingBox())?.width).toBeGreaterThan(20);
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0);
});

test("people", async ({ page }) => {
  await mockApi(page);
  await page.goto("/people", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sarah Murray", { exact: true })).toBeVisible({ timeout: 15000 });
  await expectNoAxeViolations(page);
});

test("sign in", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 15000 });
  await expectNoAxeViolations(page);
});
