import { test, expect, type Page } from "@playwright/test";
import { taskRow as row } from "./helpers/app";
import { expectNoAxeViolations } from "./helpers/axe";
import { mockApi, openList } from "./helpers/mock-api";

// Where touch reaches the same thing another way: the lists sheet for the sidebar, swipe actions
// for hover buttons. Their desktop counterparts live in the spec for each topic.
test.skip(({ isMobile }) => !isMobile, "touch only");

const openListsSheet = (page: Page) => page.getByTestId("category-nav-trigger").click();

test.describe("the lists sheet", () => {
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

    await openListsSheet(page);
    await page.getByRole("button", { name: /^Work/ }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: "Work" })).toHaveCount(1);
    await openListsSheet(page);
    await page
      .getByRole("button", { name: /^Inbox/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
  });

  test("the list title renders once, as the sheet's trigger", async ({ page }) => {
    await openList(page);
    await expect(page.getByRole("heading", { level: 2, name: "Inbox" })).toHaveCount(1);
    await expect(page.getByTestId("category-nav-trigger")).toBeVisible();
  });

  test("your shared lists read differently from lists shared with you", async ({ page }) => {
    await openList(page);
    await openListsSheet(page);
    const sharedWithMe = page.getByRole("group", { name: "Shared with me" });
    await expect(sharedWithMe.getByRole("button", { name: /^Groceries/ })).toBeVisible();
    await expect(sharedWithMe.getByRole("button", { name: /^Home/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Home Shared with Sam Okafor/ }).first(),
    ).toBeVisible();
  });

  test("a list's options open as a sheet at the bottom, where the thumb is", async ({ page }) => {
    await openList(page);
    await openListsSheet(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Work/ })
      .locator("..")
      .getByRole("button", { name: "List options" })
      .click();

    const options = page.getByRole("dialog", { name: "Work options" });
    await expect(options.getByRole("button", { name: "Rename" })).toBeVisible();
    await expect
      .poll(async () => {
        const box = await options.boundingBox();
        return box && Math.round(box.y + box.height);
      })
      .toBe(page.viewportSize()!.height);

    await options.getByRole("button", { name: "Rename" }).click();
    await expect(options).toBeHidden();
    await expect(page.getByRole("textbox", { name: "List name" })).toBeFocused();
  });

  test("a list with tasks asks before it's deleted, and Cancel keeps it", async ({ page }) => {
    await openList(page);
    await openListsSheet(page);
    // The innermost element holding both the category's button and its options trigger
    await page
      .locator("div")
      .filter({ has: page.getByRole("button", { name: /^Work/ }) })
      .filter({ has: page.getByRole("button", { name: "List options" }) })
      .last()
      .getByRole("button", { name: "List options" })
      .click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Delete “Work”?");
    await expectNoAxeViolations(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Work/ }).first()).toBeVisible();
  });
});

// The server refuses to delete a task for anyone but its owner, or the owner of its parent
test.describe("deleting someone else's task", () => {
  // Hidden too: the swipe actions stay invisible until swiped
  const deleteControls = (page: Page, title: string) =>
    row(page, title).getByRole("button", { name: /^Delete/, includeHidden: true });

  // By name: on touch the category sheet is still closing when the task's sheet opens
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
    await openListsSheet(page);
    await page
      .getByRole("group", { name: "Shared with me" })
      .getByRole("button", { name: /^Groceries/ })
      .click();
    await expect(deleteControls(page, "Eggs")).toHaveCount(0);
    await expect(await openDetail(page, "Eggs")).toHaveCount(0);
  });
});

test("an iPhone that hasn't installed Ajot is told how, until it's dismissed", async ({ page }) => {
  await mockApi(page, { setupHintSeen: false });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const offer = page.getByText("tap Share, then Add to Home Screen");
  await expect(offer).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(offer).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#add-task-input")).toBeVisible({ timeout: 15000 });
  await expect(offer).toHaveCount(0);
});

test("the Undo window lasts longer on touch", async ({ page }) => {
  await openList(page);
  await row(page, "Pick up dry cleaning").getByRole("checkbox").click();
  const toast = page.locator("[data-toast-undo]", { hasText: "“Pick up dry cleaning” done" });
  await expect(toast).toBeVisible();
  await page.waitForTimeout(6500);
  await expect(toast).toBeVisible();
});

test("a long task title keeps its toast on one line, with Undo in view", async ({ page }) => {
  await openList(page);
  const title =
    "Book flights for the October trip and check whether the Tuesday fare is still under €200";
  await row(page, "Book flights").getByRole("checkbox").first().click();
  const toast = page.locator("[data-toast-undo]", { hasText: `“${title}” done` });
  await expect(toast).toBeVisible();

  const heading = toast.getByRole("heading");
  const lineHeight = await heading.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect((await heading.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
  await expect(heading).toContainText("” done");
  await expect(toast.getByRole("button", { name: "Undo" })).toBeInViewport({ ratio: 1 });
});

test.describe("accessibility of the phone layout", () => {
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

  test("lists sheet", async ({ page }) => {
    await openList(page);
    await openListsSheet(page);
    await expect(page.getByRole("button", { name: "Add list" })).toBeVisible();
    await expectNoAxeViolations(page);
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
});
