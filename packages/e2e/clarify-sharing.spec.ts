import { test, expect, type Locator, type Page } from "./fixtures";
import { mockApi } from "./helpers/mock-api";

// A production build registers sw.js, which would answer /api before the mocks see it
test.use({ serviceWorkers: "block" });

const openList = async (page: Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const fontSizePx = (el: Locator) =>
  el.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));

test.describe("share and assignee chips", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
    await openList(page);
  });

  test("a task shared with me names its owner", async ({ page }) => {
    const face = row(page, "Pick a restaurant for Friday").getByTitle("Sarah Murray's task");
    await expect(face).toHaveText(/Sarah Murray's task/);
    await expect(face).toBeVisible();
  });

  test("a task I shared shows the people glyph, not a recipient's face", async ({ page }) => {
    const target = row(page, "Write a thank-you note to Anna");
    const glyph = target.getByTitle("Shared with Sarah Murray");
    await expect(glyph).toBeVisible();
    await expect(glyph.locator("svg")).toBeVisible();
    await expect(target.getByText("Shared with Sarah Murray")).toHaveCount(1);
    await expect(target.getByText("SM", { exact: true })).toHaveCount(0);
  });

  test("the assignee chip says who it's assigned to", async ({ page }) => {
    const target = row(page, "Sort out the car insurance");
    await expect(target.getByText("Assigned to Sam Okafor")).toHaveCount(1);
    await expect(target.getByTitle("Assigned to Sam Okafor")).toBeVisible();
  });

  test("avatar initials are at least 11px", async ({ page }) => {
    const owner = row(page, "Pick a restaurant for Friday").getByTitle("Sarah Murray's task");
    const assignee = row(page, "Sort out the car insurance").getByTitle("Assigned to Sam Okafor");
    expect(await fontSizePx(owner)).toBeGreaterThanOrEqual(11);
    expect(await fontSizePx(assignee)).toBeGreaterThanOrEqual(11);
  });
});

test("wide initials fit inside the face", async ({ page }) => {
  const user = (id: string, name: string) => ({ id, name, username: id });
  const owner = user("u-mia", "Mia Wong");
  const assignee = user("u-will", "Will Mann");
  const task = {
    id: "t-wide",
    userId: owner.id,
    categoryId: null,
    parentId: null,
    title: "Water the plants",
    description: null,
    status: "todo",
    dueDate: null,
    sortOrder: "a00",
    assigneeId: assignee.id,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
    user: { id: owner.id, name: owner.name },
    subtasks: [],
    shares: [
      {
        id: "s-wide",
        taskId: "t-wide",
        sharedWithUserId: "u-mike",
        categoryId: null,
        permission: "edit",
        createdAt: "2026-09-20T09:00:00.000Z",
        updatedAt: "2026-09-20T09:00:00.000Z",
        sharedWithUser: { id: "u-mike", name: "Mike Murray", username: "mike" },
      },
    ],
    assignee,
  };
  await mockApi(page);
  await page.route("**/api/tasks", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [task] }) : route.fallback(),
  );
  await openList(page);

  const target = row(page, "Water the plants");
  for (const title of ["Mia Wong's task", "Assigned to Will Mann"]) {
    const face = target.getByTitle(title);
    const fits = await face.evaluate((node) => {
      const initials = node.querySelector("[aria-hidden]")!.getBoundingClientRect();
      const circle = node.getBoundingClientRect();
      return initials.width <= circle.width - 2;
    });
    expect(fits, title).toBe(true);
  }
});
