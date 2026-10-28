import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./helpers/axe";
import { openList } from "./helpers/mock-api";

const openOptions = async (page: Page, name: string) => {
  // The innermost element holding both the category's button and its options trigger
  const categoryRow = page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) })
    .filter({ has: page.getByRole("button", { name: "List options" }) })
    .last();
  await categoryRow.hover();
  await categoryRow.getByRole("button", { name: "List options" }).click();
};

const deleteRequest = (page: Page) =>
  page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/api/categories"));

test("a category with tasks asks first, and Cancel keeps it", async ({ page }) => {
  await openList(page);
  await openOptions(page, "Work");
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete “Work”?");
  await expect(dialog).toContainText("It has 2 tasks.");
  await expectNoAxeViolations(page);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Work/ }).first()).toBeVisible();
});

for (const [choice, tasks] of [
  ["Move to Inbox", "uncategorise"],
  ["Delete tasks", "delete"],
] as const) {
  test(`${choice} sends that choice with the delete`, async ({ page }) => {
    await openList(page);
    await openOptions(page, "Work");
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const request = deleteRequest(page);
    await page.getByRole("alertdialog").getByRole("button", { name: choice }).click();
    const body = (await request).postDataJSON();
    // Only the tasks the dialog counted can be deleted
    expect({ ...body, taskIds: body.taskIds.toSorted() }).toEqual({
      id: "c-work",
      tasks,
      taskIds: ["t-10", "t-11"],
    });
  });
}

test("an empty category deletes without asking", async ({ page }) => {
  await openList(page);
  await openOptions(page, "Home");

  const request = deleteRequest(page);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    id: "c-home",
    tasks: "uncategorise",
    taskIds: [],
  });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText("List deleted")).toBeVisible();
});

test("Undo brings a deleted list back", async ({ page }) => {
  await openList(page);
  await openOptions(page, "Home");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const toast = page.locator("[data-toast-undo]", { hasText: "List deleted" });
  await expect(toast).toBeVisible();
  await expect(page.getByRole("button", { name: /^Home/ })).toHaveCount(0);

  const restore = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/categories/c-home/restore"),
  );
  await toast.getByRole("button", { name: "Undo" }).click();
  await restore;
  await expect(page.getByRole("button", { name: /^Home/ }).first()).toBeVisible();
});

test("a refused delete says so and brings the category back", async ({ page }) => {
  await openList(page);
  await page.route("**/api/categories", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"no"}' })
      : route.fallback(),
  );
  await openOptions(page, "Home");
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByText("Couldn't delete “Home”")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Home/ }).first()).toBeVisible();
});
