import { test, expect, type Page } from "./fixtures";
import { mockApi, mockData } from "./helpers/mock-api";

// Whose face a shared list's task shows, and accepting an invite, against mocked /api

test.use({ serviceWorkers: "block" });

const SAM = { id: "u-sam", name: "Sam Okafor", username: "sam" };

/** The mock's lists, plus a task Sam added to Home, without its owner. */
const withHomeTasks = () => {
  const data = mockData();
  const template = data.tasks.find((t) => t.title === "Pick up dry cleaning")!;
  data.tasks.push(
    {
      ...template,
      id: "t-sams",
      title: "Fix the gate latch",
      sortOrder: "b1",
      categoryId: "c-home",
      userId: SAM.id,
    },
    {
      ...template,
      id: "t-mine-home",
      title: "Paint the shed door",
      sortOrder: "b2",
      categoryId: "c-home",
    },
  );
  return data;
};

const open = async (page: Page) => {
  await mockApi(page, { data: withHomeTasks() });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const openList = async (page: Page, name: string) => {
  await page
    .getByTestId("category-sidebar")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
};

test("in a shared list, a task shows its owner's face unless it's yours", async ({ page }) => {
  await open(page);
  await openList(page, "Home");
  await expect(row(page, "Fix the gate latch").getByText("Sam Okafor's task")).toBeAttached();
  await expect(row(page, "Paint the shed door").locator('[title$="\'s task"]')).toHaveCount(0);
});

test("accepting an invite leads back to your lists", async ({ page }) => {
  await mockApi(page);
  await page.goto("/invite/abc", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Accept invite" }).click();

  await expect(
    page.getByRole("heading", { name: "You're connected with Sarah Murray." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to your lists" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
});
