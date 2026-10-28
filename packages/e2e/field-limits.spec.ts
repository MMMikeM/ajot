import { test, expect, type Page, type Request } from "@playwright/test";
import { startsWith } from "./helpers/app";
import { mockApi } from "./helpers/mock-api";

// A field stops at the length the server takes (shared/field-limits.ts), so a long paste is cut
// there rather than refused, which would drop the whole edit. Against the dev server, /api mocked.

test.use({ serviceWorkers: "block" });

const MAX_TITLE = 1_000;
const MAX_TEXT = 50_000;
const MAX_NAME = 200;

const sent = (page: Page, method: string, path: string) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === method && new URL(request.url()).pathname === path)
      bodies.push(request.postDataJSON());
  });
  return bodies;
};

const openList = async (page: Page) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-task-id]", { timeout: 15000 });
};

const openDetail = async (page: Page, title: string) => {
  await page
    .locator("[data-task-id]", { hasText: title })
    .first()
    .getByRole("button", { name: startsWith(title) })
    .click();
  const sheet = page.getByRole("dialog", { name: title, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
};

test("a task's title and description stop at their limits, and save what was kept", async ({
  page,
}) => {
  const updates = sent(page, "PUT", "/api/tasks");
  await openList(page);
  const sheet = await openDetail(page, "Pick up dry cleaning");

  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await sheet
    .getByRole("group", { name: "Add to task" })
    .getByRole("button", { name: "Description" })
    .click();
  const description = sheet.getByRole("textbox", { name: "Description" });
  await expect(description).toBeFocused();
  await page.keyboard.insertText("d".repeat(MAX_TEXT + 10));
  expect((await description.inputValue()).length).toBe(MAX_TEXT);

  // The sheet is named after the title, so it's changed last
  const title = sheet.getByRole("textbox", { name: "Title" });
  await title.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("t".repeat(MAX_TITLE + 5));
  expect((await title.inputValue()).length).toBe(MAX_TITLE);
  await page.keyboard.press("Enter");

  await expect
    .poll(() => updates.map((u) => String(u.description ?? u.title).length))
    .toEqual([MAX_TEXT, MAX_TITLE]);
});

test("a new note stops at its limit, and its title is the start of it", async ({ page }) => {
  const created = sent(page, "POST", "/api/notes");
  await openList(page);
  const sheet = await openDetail(page, "Pick up dry cleaning");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await sheet
    .getByRole("group", { name: "Add to task" })
    .getByRole("button", { name: "Note" })
    .click();

  const note = sheet.getByRole("textbox", { name: "New note" });
  await expect(note).toBeFocused();
  await page.keyboard.insertText("n".repeat(MAX_TEXT + 10));
  expect((await note.inputValue()).length).toBe(MAX_TEXT);
  await page.keyboard.press("Enter");

  await expect
    .poll(() => created.map((n) => [String(n.title).length, String(n.content).length]))
    .toEqual([[MAX_TITLE, MAX_TEXT]]);
});

test("a new task's title and a new list's name stop at their limits", async ({ page }) => {
  await openList(page);

  const add = page.locator("#add-task-input");
  await add.click();
  await page.keyboard.insertText("a".repeat(MAX_TITLE + 5));
  expect((await add.inputValue()).length).toBe(MAX_TITLE);

  await page.getByTestId("category-sidebar").getByLabel("Add list").click();
  const name = page.getByPlaceholder("Name...");
  await expect(name).toBeFocused();
  await page.keyboard.insertText("l".repeat(MAX_NAME + 5));
  expect((await name.inputValue()).length).toBe(MAX_NAME);
});
