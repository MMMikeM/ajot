import { test, expect, type Page } from "@playwright/test";
import { mockApi, mockData } from "./helpers/mock-api";

// Against mocked /api: a list whose order keys aren't what fractional-indexing makes

test.use({ serviceWorkers: "block" });

const inboxTitles = (page: Page) =>
  page.locator("[data-task-id]").evaluateAll((rows) => rows.map((r) => r.textContent ?? ""));

test("a task is still added when a neighbour's sortOrder is malformed", async ({ page }) => {
  const data = mockData();
  const last = data.tasks
    .filter((t) => !t.parentId && !t.categoryId && t.status !== "done")
    .at(-1)!;
  // Sorts after every valid key, and fractional-indexing throws on it
  last.sortOrder = "a10";
  const added: { title?: string; sortOrder?: string }[] = [];
  await mockApi(page, { data });
  await page.route("**/api/tasks", (route) => {
    if (route.request().method() === "POST") added.push(route.request().postDataJSON());
    return route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");

  await page.fill("#add-task-input", "Added after a bad key");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Added after a bad key")).toBeVisible();
  await expect.poll(() => added.length).toBe(1);
  const others = data.tasks.filter((t) => !t.parentId && t !== last).map((t) => t.sortOrder);
  expect(others.every((key) => added[0]!.sortOrder! > key)).toBe(true);
});

test("tasks show in the order their keys sort by code unit", async ({ page }) => {
  const data = mockData();
  const inbox = data.tasks.filter((t) => !t.parentId && !t.categoryId && t.status !== "done");
  const [first, second] = inbox;
  // What dragging a task above "a0" gives it; localeCompare puts it after every "a" key
  first!.sortOrder = "a0";
  second!.sortOrder = "Zz";
  await mockApi(page, { data });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]");

  const titles = await inboxTitles(page);
  expect(titles.findIndex((t) => t.includes(second!.title))).toBe(0);
});
