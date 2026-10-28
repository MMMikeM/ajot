import { test, expect, type Page } from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

// Who a task came from, inviting from the share sheets, and faces, against mocked /api

test.use({ serviceWorkers: "block" });

const SARAH = { id: "u-sarah", name: "Sarah Murray", username: "sarah" };
const SAM = { id: "u-sam", name: "Sam Okafor", username: "sam" };

type Data = ReturnType<typeof mockData>;

const member = (categoryId: string, user: typeof SAM) => ({
  id: `cc-${categoryId}-${user.id}`,
  categoryId,
  userId: user.id,
  addedAt: "2026-09-20T09:00:00.000Z",
  user: { ...user, avatarUrl: null },
});

/** The mock's lists, plus a task Sarah sent and one Sam added to Home, without its owner. */
const withSenders = () => {
  const data = mockData();
  const template = data.tasks.find((t) => t.title === "Pick up dry cleaning")!;
  data.tasks.push(
    {
      ...template,
      id: "t-sent",
      title: "Pick up Gran's prescription",
      sortOrder: "b0",
      sentById: SARAH.id,
      sentBy: { id: SARAH.id, name: SARAH.name },
    },
    // As a live insert has it: no user
    {
      ...template,
      id: "t-sams",
      title: "Fix the gate latch",
      sortOrder: "b1",
      categoryId: "c-home",
      userId: SAM.id,
      user: null as never,
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

const open = async (page: Page, data: Data = withSenders(), path = "/") => {
  await mockApi(page, { data });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(path === "/" ? "[data-task-id]" : "h2", { timeout: 15000 });
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

const openHomeShareSheet = async (page: Page) => {
  const pill = page
    .getByTestId("category-sidebar")
    .locator("div")
    .filter({ has: page.getByRole("button", { name: /^Home/ }) })
    .last();
  await pill.hover();
  await pill.getByRole("button", { name: "List options" }).click({ force: true });
  await page.getByTestId("category-share-btn").click();
};

const faceColour = (page: Page, label: string) =>
  page
    .locator(`[title="${label}"]`)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test("a task someone sent says who sent it, in the row and the sheet", async ({ page }) => {
  await open(page);
  await expect(row(page, "Pick up Gran")).toContainText("From Sarah");
  await expect(row(page, "Pick up Gran").getByText("Sent by Sarah Murray")).toBeAttached();
  await row(page, "Pick up Gran")
    .getByRole("button", { name: /^Pick up Gran/ })
    .click();
  await expect(page.getByRole("dialog").getByText("Sent by Sarah Murray")).toBeVisible();
});

test("in a shared list, a task shows its owner's face unless it's yours", async ({ page }) => {
  await open(page);
  await openList(page, "Home");
  await expect(row(page, "Fix the gate latch").getByText("Sam Okafor's task")).toBeAttached();
  await expect(row(page, "Paint the shed door").locator('[title$="\'s task"]')).toHaveCount(0);

  await openList(page, "Groceries");
  await expect(row(page, "Eggs").getByText("Sarah Murray's task")).toBeAttached();
  await expect(row(page, "Sourdough").locator('[title$="\'s task"]')).toHaveCount(0);
});

test("a person's face is the same colour everywhere", async ({ page }) => {
  await open(page);
  const onRow = await faceColour(page, "Sarah Murray's task");
  await openList(page, "Groceries");
  const onList = await faceColour(page, "Sarah Murray's task");
  await page.goto("/people");
  await page.waitForSelector("h2");
  const onPeople = await faceColour(page, "Sarah Murray");
  expect(new Set([onRow, onList, onPeople]).size).toBe(1);
  expect(await faceColour(page, "Sam Okafor")).not.toBe(onPeople);
});

test("adding the last contact to a list leaves focus on an invite", async ({ page }) => {
  const data = withSenders();
  await open(page, data);
  await page.route("**/api/categories/c-home/collaborators", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    data.categories.find((c) => c.id === "c-home")!.collaborators.push(member("c-home", SARAH));
    return route.fulfill({ json: { ...SARAH, avatarUrl: null } });
  });
  await openHomeShareSheet(page);
  await page.getByRole("combobox", { name: "Add someone" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: /Sarah Murray/ }).press("Enter");

  const invite = page.getByRole("button", { name: "Invite someone new" });
  await expect(invite).toBeFocused();
  await expect(page.getByText("Everyone in your contacts is on this list.")).toBeVisible();
});

test("a task shared with every contact still offers an invite", async ({ page }) => {
  const data = withSenders();
  const note = data.tasks.find((t) => t.title.startsWith("Write a thank-you"))!;
  note.shares = [SARAH, SAM].map((user) => ({
    id: `s-${user.id}`,
    taskId: note.id,
    sharedWithUserId: user.id,
    categoryId: null,
    permission: "edit",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    sharedWithUser: user,
  }));
  await open(page, data);
  await row(page, "Write a thank-you")
    .getByRole("button", { name: /^Write a thank-you/ })
    .click();
  await page.getByRole("button", { name: /^Add$/ }).click();
  await page.getByRole("button", { name: /^Share$/ }).click();
  await expect(page.getByText("Shared with all your contacts.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite someone new" })).toBeVisible();
});

test("People with no contacts offers one invite", async ({ page }) => {
  const data = withSenders();
  data.contacts = [];
  await open(page, data, "/people");
  await expect(page.getByRole("button", { name: /invite/i })).toHaveCount(1);
  await expect(page.getByText(/^No contacts yet/)).not.toContainText("Invite someone");
});

test("accepting an invite leads back to your lists, with People a step away", async ({ page }) => {
  await mockApi(page);
  await page.goto("/invite/abc", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Accept invite" }).click();

  await expect(
    page.getByRole("heading", { name: "You're connected with Sarah Murray." }),
  ).toBeVisible();
  const toLists = page.getByRole("button", { name: "Go to your lists" });
  await expect(toLists).toBeFocused();
  await expect(page.getByRole("button", { name: "See People" })).toBeVisible();

  await toLists.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-task-id]").first()).toBeVisible();
});
