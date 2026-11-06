import { test, expect } from "./fixtures";
import { signIn } from "./helpers/auth";
import { createCategory } from "./helpers/app";
import { apiRequest } from "./helpers/api";

// Sidebar or sheet is chosen by pointer type (`touch:` is pointer:coarse), which the
// mobile project (iPhone 14) emulates.

const APP_SHELL_MAIN_CLASS = "max-w-sm";

test.beforeEach(async ({ page, user1Auth }) => {
  // Tasks first: the server won't delete a category that still has tasks
  const tasks = await apiRequest<{ id: string; parentId: string | null }[]>(
    "GET",
    "/api/tasks",
    undefined,
    user1Auth.token,
  );
  await Promise.allSettled(
    tasks
      .filter((t) => !t.parentId)
      .map((t) => apiRequest("DELETE", "/api/tasks", { id: t.id }, user1Auth.token)),
  );
  const categories = await apiRequest<{ id: string }[]>(
    "GET",
    "/api/categories",
    undefined,
    user1Auth.token,
  );
  await Promise.allSettled(
    categories.map((c) => apiRequest("DELETE", "/api/categories", { id: c.id }, user1Auth.token)),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await signIn(page, user1Auth);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#add-task-input", { timeout: 10000 });
  // CategoryMobileSheet is lazy — wait for trigger on mobile (no-op on desktop)
  await page
    .locator('[data-testid="category-nav-trigger"]')
    .waitFor({ timeout: 3000 })
    .catch(() => {});
});

test("desktop: Settings link in the sidebar opens Settings", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "desktop only");

  await page.getByTestId("category-sidebar").getByRole("link", { name: "Settings" }).click();

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByTestId("category-sidebar").getByRole("link", { name: "Settings" }),
  ).toHaveAttribute("data-status", "active");
});

const openCategoryOptionsPopover = async (
  page: Parameters<typeof createCategory>[0],
  categoryName: string,
) => {
  const sidebar = page.getByTestId("category-sidebar");
  // The name's <button> sits directly inside the pill <div>
  const categoryBtn = sidebar.locator(`button:has-text("${categoryName}")`).first();
  const pill = categoryBtn.locator("..");
  await pill.hover();
  // The trigger is opacity-0 until hover; force skips the visibility check
  await pill.getByRole("button", { name: "List options" }).click({ force: true });
};

test("desktop: category options popover Rename item is not obscured by main content", async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, "desktop only");

  await createCategory(page, "LayerTest", "sidebar");
  await openCategoryOptionsPopover(page, "LayerTest");

  const renameBtn = page.getByRole("button", { name: "Rename", exact: true });
  await expect(renameBtn).toBeVisible({ timeout: 3000 });

  const box = await renameBtn.boundingBox();
  if (!box) throw new Error("Rename button has no bounding box");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const topElement = await page.evaluate(
    ([x, y, mainClass]) => {
      const el = document.elementFromPoint(x, y);
      let cur: Element | null = el;
      while (cur) {
        if (cur.getAttribute("data-popup") !== null) return "popover";
        if (cur.getAttribute("data-slot") === "button") return "popover";
        if (cur.textContent?.trim() === "Rename") return "popover";
        if (cur.getAttribute("data-testid") === "category-sidebar") return "popover";
        if (cur.classList.contains(mainClass)) return "main-content";
        cur = cur.parentElement;
      }
      return "unknown";
    },
    [cx, cy, APP_SHELL_MAIN_CLASS] as [number, number, string],
  );

  expect(topElement).toBe("popover");
});

test("desktop: clicking Rename in category options starts rename flow", async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, "desktop only");

  await createCategory(page, "RenameMe", "sidebar");
  await openCategoryOptionsPopover(page, "RenameMe");

  // Exact: "RenameMe" is a button too
  const renameBtn = page.getByRole("button", { name: "Rename", exact: true });
  await expect(renameBtn).toBeVisible({ timeout: 3000 });
  // locator.click() dispatches CDP pointer events which interfere with
  // floating-ui's useDismiss insideReactTree flag. Use element.click() instead.
  await renameBtn.evaluate((el) => (el as HTMLElement).click());

  const sidebar = page.getByTestId("category-sidebar");
  await expect(sidebar.locator('input[type="text"]')).toBeVisible({ timeout: 3000 });
});

test("desktop: clicking Delete in category options removes the category", async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, "desktop only");

  await createCategory(page, "DeleteMe", "sidebar");
  await openCategoryOptionsPopover(page, "DeleteMe");

  // Exact: "DeleteMe" and each task's "Delete task" are buttons too
  const deleteBtn = page.getByRole("button", { name: "Delete", exact: true });
  await expect(deleteBtn).toBeVisible({ timeout: 3000 });
  // Same floating-ui/CDP issue as Rename above
  await deleteBtn.evaluate((el) => (el as HTMLElement).click());

  await expect(page.getByTestId("category-sidebar").getByText("DeleteMe")).toHaveCount(0, {
    timeout: 5000,
  });
});

test("mobile: selecting a category from the sheet closes it and updates trigger", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "mobile only");

  const trigger = page.getByTestId("category-nav-trigger");

  await trigger.tap();
  await page.getByRole("button", { name: "Add list" }).tap();
  await page.locator('input[placeholder="List name..."]').fill("Errands");
  await page.keyboard.press("Enter");

  // The sheet stays open after adding
  await page.getByRole("button", { name: "Errands" }).tap();

  await expect(trigger).toContainText("Errands");
  await expect(page.getByRole("button", { name: "Add list" })).toBeHidden({ timeout: 3000 });
});

test("mobile: Settings link in the sheet opens Settings", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile only");

  await page.getByTestId("category-nav-trigger").tap();
  await page.getByRole("link", { name: "Settings" }).tap();

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add list" })).toBeHidden({ timeout: 3000 });
});
