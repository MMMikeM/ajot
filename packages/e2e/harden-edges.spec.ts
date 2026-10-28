import { test, expect, type Page } from "@playwright/test";
import { mockApi, noteOn } from "./helpers/mock-api";
import { expectTapTarget } from "./helpers/touch";

// Edge cases in the list chrome, against the dev server with /api mocked

// A production build registers sw.js, which would answer /api before the mocks see it
test.use({ serviceWorkers: "block" });

const LONG_NAME = "Side project — the garden shed rebuild, phase two, before the spring rains";

const openList = async (page: Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const openNavSheet = async (page: Page) => {
  await page.getByTestId("category-nav-trigger").tap();
  await expect(page.getByRole("dialog")).toBeVisible();
};

test("a long list name stays readable", async ({ page }, testInfo) => {
  const data = await mockApi(page);
  const longList = { ...data.categories[0], id: "c-long", name: LONG_NAME, sortOrder: "a3" };
  // Registered after mockApi, so it answers first
  await page.route("**/api/categories", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [...data.categories, longList] })
      : route.fallback(),
  );
  await openList(page);

  if (testInfo.project.name === "desktop") {
    const pill = page.getByTestId("category-sidebar").getByRole("button", { name: LONG_NAME });
    await expect(pill).toBeVisible();
    await expect(pill.getByTitle(LONG_NAME)).toBeVisible();
    return;
  }

  await openNavSheet(page);
  const name = page.getByRole("dialog").getByText(LONG_NAME);
  await expect(name).toBeVisible();
  // Wrapped, not clipped
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const { height } = (await name.boundingBox())!;
  expect(height).toBeGreaterThan(30);

  // The list title is the only other full view of the name on touch, so it wraps too
  await name.tap();
  await expect(page.getByRole("dialog")).toBeHidden();
  const title = page.getByTestId("category-nav-trigger");
  await expect(title.getByText(LONG_NAME)).toBeVisible();
  const box = (await title.boundingBox())!;
  expect(box.height).toBeGreaterThan(60);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("a long URL or list name keeps the task sheet's controls on screen", async ({ page }) => {
  const URL = "https://example.com/" + "longpathsegment/".repeat(8) + "?with=query";
  const data = await mockApi(page);
  data.categories.push({ ...data.categories[0]!, id: "c-long", name: LONG_NAME, sortOrder: "a3" });
  const flights = data.tasks[0]!;
  flights.categoryId = "c-long";
  data.tasks[1]!.categoryId = "c-long";
  data.tasks[1]!.title = URL;
  data.notes.push(noteOn(flights, URL, { title: URL }));
  await page.goto(`/task/${flights.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.locator('[data-slot="drawer-content"]');
  await expect(sheet.getByText(URL).first()).toBeVisible({ timeout: 15000 });

  const sheetRight = await sheet.evaluate((el) => el.getBoundingClientRect().right);
  const controls = [
    sheet.getByRole("combobox", { name: "List" }),
    sheet.getByRole("group", { name: "Subtasks" }).getByRole("button", { name: "Delete" }),
    sheet.getByRole("group", { name: "Notes" }).getByRole("button", { name: "Edit" }),
    sheet.getByRole("group", { name: "Notes" }).getByRole("button", { name: "Delete" }),
  ];
  for (const control of controls) {
    for (const each of await control.all()) {
      const right = await each.evaluate((el) => el.getBoundingClientRect().right);
      expect(right).toBeLessThanOrEqual(sheetRight);
    }
  }
});

test("on a 320px phone a note keeps most of its row", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "desktop floats the actions over the row");
  await page.setViewportSize({ width: 320, height: 568 });
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  data.notes.push(noteOn(flights, "Window seat if possible"));
  await page.goto(`/task/${flights.id}`, { waitUntil: "domcontentloaded" });
  const notes = page.locator('[data-slot="drawer-content"]').getByRole("group", { name: "Notes" });
  const text = notes.getByRole("button", { name: /^Edit note/ });
  await expect(text).toBeVisible({ timeout: 15000 });
  const rowBox = (await text.locator("xpath=..").boundingBox())!;
  const textBox = (await text.boundingBox())!;
  expect(textBox.width / rowBox.width).toBeGreaterThan(0.75);

  await expectTapTarget(notes.getByRole("button", { name: "Delete note" }));
});

test.describe("done section", () => {
  test("remembers that it was open", async ({ page }) => {
    await mockApi(page);
    await openList(page);
    const toggle = page.getByRole("button", { name: /done \(\d+\)/i });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(row(page, "Buy oat milk")).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /done \(\d+\)/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(row(page, "Buy oat milk")).toBeVisible();
  });

  test("Clear removes your done tasks, and Undo brings them back", async ({ page }) => {
    const data = await mockApi(page);
    const oatMilk = data.tasks.find((t) => t.title === "Buy oat milk")!;
    data.tasks.push({
      ...oatMilk,
      id: "t-oat-receipt",
      title: "Keep the receipt",
      parentId: oatMilk.id,
      sortOrder: "b0",
    });
    const deleted: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE" && new URL(request.url()).pathname === "/api/tasks")
        deleted.push((request.postDataJSON() as { id: string }).id);
    });
    await openList(page);

    await page.getByRole("button", { name: /done \(2\)/i }).click();
    await expect(page.getByRole("button", { name: "Clear done tasks" })).toBeVisible();
    await page.getByRole("button", { name: "Clear done tasks" }).click();

    await expect(page.locator("[data-toast-undo]")).toContainText("Cleared 2 done tasks");
    await expect(page.getByRole("button", { name: /done \(\d+\)/i })).toHaveCount(0);
    await expect(row(page, "Buy oat milk")).toHaveCount(0);
    await expect(row(page, "Return library books")).toHaveCount(0);
    const doneIds = data.tasks
      .filter((t) => t.status === "done" && !t.parentId)
      .map((t) => t.id)
      .sort();
    await expect.poll(() => [...deleted].sort()).toEqual(doneIds);
    // A done subtask under an open task isn't in Done, so it stays
    await expect(
      row(page, "Book flights").getByRole("button", { name: "1 done subtask" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: /done \(2\)/i })).toBeVisible();
    await expect(row(page, "Buy oat milk")).toBeVisible();
    await expect(row(page, "Return library books")).toBeVisible();
    // A done parent hides its subtasks in the list, so look in its sheet
    await row(page, "Buy oat milk")
      .getByRole("button", { name: /^Buy oat milk/ })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("checkbox", { name: "Keep the receipt" }),
    ).toBeVisible();
  });

  test("Clear is absent when none of the done tasks are yours", async ({ page }) => {
    const data = await mockApi(page);
    // Sarah's done tasks in her Groceries list, which she shares with Mike
    for (const t of data.tasks)
      if (t.status === "done" && !t.parentId)
        Object.assign(t, {
          categoryId: "c-groc",
          userId: "u-sarah",
          user: { id: "u-sarah", name: "Sarah Murray" },
        });
    await page.addInitScript(() => localStorage.setItem("newtab-todo-active-category", "c-groc"));
    await openList(page);
    await page.getByRole("button", { name: /done \(\d+\)/i }).click();
    await expect(row(page, "Buy oat milk")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear done tasks" })).toHaveCount(0);
  });
});

test("a list's colour can be removed", async ({ page }, testInfo) => {
  await mockApi(page);
  const puts: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/categories")
      puts.push(request.postDataJSON() as Record<string, unknown>);
  });
  await openList(page);

  if (testInfo.project.name === "desktop") {
    // The name's <button> sits directly inside the pill, beside the options trigger
    const pill = page
      .getByTestId("category-sidebar")
      .getByRole("button", { name: /^Work/ })
      .locator("..");
    await pill.hover();
    await pill.getByRole("button", { name: "List options" }).click();
  } else {
    await openNavSheet(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Work/ })
      .locator("..")
      .getByRole("button", { name: "List options" })
      .tap();
  }

  const none = page.getByRole("button", { name: "No colour" });
  await expect(none).toHaveAttribute("aria-pressed", "false");
  await none.click();
  await expect.poll(() => puts.find((p) => p.id === "c-work")).toMatchObject({ color: null });
  await expect(none).toHaveAttribute("aria-pressed", "true");
});

test("a task with done subtasks says so, and the hint opens it", async ({ page }) => {
  await mockApi(page);
  await openList(page);
  const flights = row(page, "Book flights");
  await expect(flights.getByText("Compare Tuesday and Wednesday fares")).toBeVisible();
  await expect(flights.getByText("Ask Sam about airport pickup")).toHaveCount(0);

  await flights.getByRole("button", { name: "1 done subtask" }).click();
  await expect(page.locator('[data-slot="drawer-content"]')).toBeVisible();
});

test("People is hidden while signed out", async ({ page }, testInfo) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  if (testInfo.project.name === "desktop") {
    const sidebar = page.getByTestId("category-sidebar");
    await expect(sidebar.getByRole("button", { name: /^Inbox/ })).toBeVisible({ timeout: 15000 });
    await expect(sidebar.getByRole("link", { name: "People" })).toHaveCount(0);
    return;
  }

  await expect(page.getByTestId("category-nav-trigger")).toBeVisible({ timeout: 15000 });
  await openNavSheet(page);
  await expect(page.getByRole("dialog").getByRole("button", { name: /^Inbox/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "People" })).toHaveCount(0);
});
