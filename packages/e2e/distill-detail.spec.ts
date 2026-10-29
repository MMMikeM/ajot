import { test, expect, type Page } from "./fixtures";
import { openListPicker, startsWith, tapAddLine } from "./helpers/app";
import { MOCK_ME, MOCK_SARAH, mockApi, noteOn, shareWith } from "./helpers/mock-api";

// The task detail sheet: what a task has, and a quiet line to add what it hasn't, where it would
// live. Against the dev server with /api mocked

test.use({ serviceWorkers: "block" });

const row = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

const openDetail = async (page: Page, title: string) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await row(page, title)
    .getByRole("button", { name: startsWith(title) })
    .click();
  const sheet = page.getByRole("dialog", { name: title, exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
};

const toast = (page: Page) => page.locator("[data-toast-undo]");

test("an empty task offers each field where it would live, and each line opens it", async ({
  page,
}) => {
  const sheet = await openDetail(page, "Pick up dry cleaning");

  await expect(sheet.getByRole("textbox", { name: "Title" })).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Details" })).toHaveAttribute(
    "placeholder",
    "Add details",
  );
  for (const name of ["New subtask", "New note"])
    await expect(sheet.getByRole("textbox", { name })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /^Due date/ })).toHaveCount(0);
  await expect(sheet.getByRole("radiogroup", { name: "Assignee" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: "Add to task" })).toHaveCount(0);
  for (const line of ["Add a date", "Share", "Add a subtask", "Add a note"])
    await expect(sheet.getByRole("button", { name: line, exact: true })).toBeVisible();
  // Nobody else can see it, so there's no one to assign it to
  await expect(sheet.getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);

  await sheet.getByRole("textbox", { name: "Details" }).click();
  await page.keyboard.type("Ticket is in the car");

  await tapAddLine(sheet, "Add a subtask");
  await expect(sheet.getByRole("textbox", { name: "New subtask" })).toBeFocused();
  await expect(sheet.getByRole("button", { name: "Add a subtask" })).toHaveCount(0);
  await page.keyboard.type("Find the ticket");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("checkbox", { name: "Find the ticket" })).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Subtasks" })).toContainText("0 of 1");

  await tapAddLine(sheet, "Add a note");
  await expect(sheet.getByRole("textbox", { name: "New note" })).toBeFocused();
  await page.keyboard.type("Closes at 6");
  await page.keyboard.press("Enter");
  await expect(sheet.getByText("Closes at 6")).toBeVisible();
  await expect(sheet.getByRole("group", { name: "Notes" }).locator("time")).toHaveText(/^Today, /);

  await openListPicker(sheet);
  await page.getByRole("option", { name: "Work" }).click();
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveText(/Work/);

  await tapAddLine(sheet, "Share");
  // The share itself arrives over SSE, which the mocks don't send
  const share = page.waitForRequest((r) => r.url().endsWith("/api/tasks/share"));
  await page.getByRole("option", { name: "Sarah Murray" }).click();
  expect((await share).postDataJSON()).toMatchObject({ username: "sarah" });
});

test("a task shared with you names its owner and offers no assignee pills", async ({ page }) => {
  const sheet = await openDetail(page, "Pick a restaurant for Friday");

  await expect(sheet.getByText("Sarah Murray’s task")).toBeVisible();
  await expect(sheet.getByText("Owner", { exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("radiogroup", { name: "Assignee" })).toHaveCount(0);
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  // Shared with you, and nobody else: no list of people that would name you as a third party
  await expect(sheet.getByRole("group", { name: "Shared with" })).toHaveCount(0);
  await expect(sheet.getByText("Mike Murray")).toHaveCount(0);

  await expect(sheet.getByRole("button", { name: /^Share/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);
});

test("the owner of a shared task can assign it", async ({ page }) => {
  const sheet = await openDetail(page, "Write a thank-you note to Anna");
  await expect(sheet.getByRole("group", { name: "Shared with" })).toContainText("Sarah Murray");

  await tapAddLine(sheet, "Assign");
  const pills = sheet.getByRole("radiogroup", { name: "Assignee" });
  await expect(pills.getByRole("radio")).toHaveText(["Unassigned", "You", "Sarah Murray"]);
  await pills.getByRole("radio", { name: "Sarah Murray" }).click();
  await expect(pills.getByRole("radio", { name: "Sarah Murray" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("an assigned task shows who has it, and the owner can take it back", async ({ page }) => {
  const sheet = await openDetail(page, "Sort out the car insurance renewal before it lapses");
  const pills = sheet.getByRole("radiogroup", { name: "Assignee" });
  await expect(pills.getByRole("radio")).toHaveText(["Unassigned", "You", "Sam Okafor"]);
  await expect(pills.getByRole("radio", { name: "Sam Okafor" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("ticking in the sheet offers Undo, and Undo restores it", async ({ page }) => {
  const sheet = await openDetail(page, "Pick up dry cleaning");
  const checkbox = sheet.getByRole("checkbox", { name: "Mark done" });

  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(toast(page)).toContainText("“Pick up dry cleaning” done");

  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(checkbox).not.toBeChecked();
  await expect(toast(page)).toHaveCount(0);
  // Pressing the toast isn't a press outside the sheet
  await expect(sheet).toBeVisible();
});

test("deleting a subtask or a note offers Undo", async ({ page }) => {
  const sheet = await openDetail(
    page,
    "Book flights for the October trip and check whether the Tuesday fare is still under €200",
  );
  const subtask = sheet.locator(".group\\/row", { hasText: "Compare Tuesday and Wednesday fares" });
  await subtask.hover();
  await subtask.getByRole("button", { name: "Delete subtask" }).click();
  await expect(subtask).toHaveCount(0);
  await expect(toast(page)).toContainText("“Compare Tuesday and Wednesday fares” deleted");
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(
    sheet.getByRole("checkbox", { name: "Compare Tuesday and Wednesday fares" }),
  ).toBeVisible();

  await tapAddLine(sheet, "Add a note");
  await page.keyboard.type("Window seat");
  await page.keyboard.press("Enter");
  const note = sheet.locator(".group\\/row", { hasText: "Window seat" });
  await note.hover();
  await note.getByRole("button", { name: "Delete note" }).click();
  await expect(note).toHaveCount(0);
  await expect(toast(page).first()).toContainText("Note “Window seat” deleted");
  await toast(page).first().getByRole("button", { name: "Undo" }).click();
  await expect(sheet.getByText("Window seat")).toBeVisible();
});

test("each Delete in the sheet says what it removes", async ({ page }) => {
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  data.notes.push(noteOn(flights, "Window seat"));
  await page.goto(`/task/${flights.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.locator('[data-slot="drawer-content"]');
  await expect(sheet.getByText("Window seat")).toBeVisible({ timeout: 15000 });

  const deleteTask = sheet.getByRole("button", { name: "Delete task", exact: true });
  await expect(deleteTask).toHaveText("");
  await expect(deleteTask).toHaveAttribute("title", "Delete task");
  await expect(
    sheet.getByRole("group", { name: "Subtasks" }).getByRole("button", { name: "Delete subtask" }),
  ).toHaveCount(2);
  await expect(
    sheet.getByRole("group", { name: "Notes" }).getByRole("button", { name: "Delete note" }),
  ).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
});

test("a note edits in place when its text is clicked", async ({ page }) => {
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  data.notes.push(noteOn(flights, "Window seat"));
  await page.goto(`/task/${flights.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.locator('[data-slot="drawer-content"]');
  await sheet.getByRole("button", { name: "Edit note: Window seat" }).click({ timeout: 15000 });
  const field = sheet.getByRole("textbox", { name: "Note" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Window seat");
  await field.fill("Aisle seat");
  await field.blur();
  await expect(sheet.getByRole("button", { name: "Edit note: Aisle seat" })).toBeVisible();
});

test("the list picker shows every list, in the sidebar's order", async ({ page }) => {
  const data = await mockApi(page);
  for (const [i, name] of ["Garden", "Reading", "Errands", "Birthday party"].entries())
    data.categories.push({
      ...data.categories[0]!,
      id: `c-extra-${i}`,
      name,
      sortOrder: `a${3 + i}`,
      collaborators: [],
    });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await row(page, "Pick up dry cleaning")
    .getByRole("button", { name: startsWith("Pick up dry cleaning") })
    .click();
  const sheet = page.getByRole("dialog", { name: "Pick up dry cleaning", exact: true });
  await openListPicker(sheet);

  const options = page.getByRole("option");
  await expect(options).toHaveText([
    "Inbox",
    "Work",
    "Home",
    "Garden",
    "Reading",
    "Errands",
    "Birthday party",
    "Groceries",
  ]);
  // Every one in view at once: inside the sheet's scroll box the popup was cut to two rows
  const popup = page.locator('[data-slot="select-popup"]');
  await expect
    .poll(() => popup.evaluate((el) => el.scrollHeight <= el.clientHeight + 1))
    .toBe(true);
  for (const option of await options.all()) await expect(option).toBeInViewport({ ratio: 1 });
});

test("Delete task closes the sheet and offers Undo", async ({ page }) => {
  const sheet = await openDetail(page, "Pick up dry cleaning");
  await sheet.getByRole("button", { name: "Delete task" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row(page, "Pick up dry cleaning")).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Pick up dry cleaning")).toBeVisible();
  // Undo closes its toast, so the task can't be restored a second time
  await expect(toast(page)).toHaveCount(0);
  await expect(page.locator("[data-task-id]", { hasText: "Pick up dry cleaning" })).toHaveCount(1);
});

test("on desktop the sheet docks inside the notepad's inset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the inset sheet is desktop-only");
  await openDetail(page, "Pick up dry cleaning");
  const content = page.locator('[data-slot="drawer-content"]');
  // Measure after the slide-in settles
  await expect
    .poll(async () => content.evaluate((el) => getComputedStyle(el).transform))
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);

  const sheetBox = (await content.boundingBox())!;
  const columnBox = (await page.locator(".bg-shell").first().boundingBox())!;
  const { height } = page.viewportSize()!;
  const inset = await page.evaluate(
    () => parseFloat(getComputedStyle(document.documentElement).fontSize) * 2,
  );

  expect(Math.abs(sheetBox.x - columnBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(sheetBox.width - columnBox.width)).toBeLessThanOrEqual(1);
  expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(height - inset + 1);
  expect(sheetBox.y).toBeGreaterThanOrEqual(inset);
});

test("a subtask's title edits in place: Enter saves it, Escape keeps the old one", async ({
  page,
}) => {
  const sheet = await openDetail(
    page,
    "Book flights for the October trip and check whether the Tuesday fare is still under €200",
  );
  const saved: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/tasks")
      saved.push(request.postDataJSON());
  });

  await sheet.getByRole("button", { name: "Edit Compare Tuesday and Wednesday fares" }).click();
  const field = sheet.getByRole("textbox", { name: "Subtask" });
  await field.fill("Compare the midweek fares");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("button", { name: "Edit Compare the midweek fares" })).toBeVisible();
  await expect
    .poll(() => saved)
    .toContainEqual(expect.objectContaining({ title: "Compare the midweek fares" }));

  await sheet.getByRole("button", { name: "Edit Compare the midweek fares" }).click();
  await field.fill("Not this");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Edit Compare the midweek fares" })).toBeVisible();
  expect(saved).toHaveLength(1);
});

test("the header names the task's list, and moves it from there", async ({ page }) => {
  const sheet = await openDetail(page, "Pick up dry cleaning");
  const list = sheet.getByRole("combobox", { name: "List" });
  await expect(list).toHaveText("Inbox");

  await list.click();
  await page.getByRole("option", { name: "Work" }).click();
  await expect(list).toHaveText("Work");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(row(page, "Pick up dry cleaning")).toHaveCount(0);
});

test("a task that isn't yours to move names its list as plain text", async ({ page }) => {
  await mockApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("group", { name: "Shared with me" })
    .getByRole("button", { name: /^Groceries/ })
    .click();
  await row(page, "Eggs").getByRole("button", { name: "Eggs", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Eggs", exact: true });

  await expect(sheet.getByRole("group", { name: "List" })).toHaveText("Groceries");
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveCount(0);
});

test("a subtask's sheet says what it's a subtask of, and opens that task", async ({ page }) => {
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  const fares = data.tasks.find((t) => t.title === "Compare Tuesday and Wednesday fares")!;
  await page.goto(`/task/${fares.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: fares.title, exact: true });
  await expect(sheet).toBeVisible({ timeout: 15000 });

  // A subtask follows its parent's list, and has no subtasks of its own
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Add a subtask" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Delete subtask" })).toBeVisible();

  await sheet.getByRole("button", { name: `Subtask of ${flights.title}` }).click();
  await page.waitForURL(`**/task/${flights.id}`);
  const parent = page.getByRole("dialog", { name: flights.title, exact: true });
  await expect(parent.getByRole("textbox", { name: "Details" })).toHaveValue(flights.description!);
  // In place of the subtask's sheet, so closing lands on the list
  await page.keyboard.press("Escape");
  await expect(parent).toHaveCount(0);
  await page.waitForURL((url) => url.pathname === "/");
});

test("a subtask's header trash deletes it, with Undo", async ({ page }) => {
  const data = await mockApi(page);
  const fares = data.tasks.find((t) => t.title === "Compare Tuesday and Wednesday fares")!;
  await page.goto(`/task/${fares.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: fares.title, exact: true });

  await sheet.getByRole("button", { name: "Delete subtask" }).click({ timeout: 15000 });
  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText(`“${fares.title}” deleted`);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await row(page, "Book flights")
    .getByRole("button", { name: startsWith("Book flights") })
    .first()
    .click();
  await expect(
    page.locator('[data-slot="drawer-content"]').getByRole("checkbox", { name: fares.title }),
  ).toBeVisible();
});

test("a subtask of a shared task says who else has it", async ({ page }) => {
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  flights.shares = [shareWith(flights.id, MOCK_SARAH)];
  const fares = data.tasks.find((t) => t.title === "Compare Tuesday and Wednesday fares")!;
  await page.goto(`/task/${fares.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: fares.title, exact: true });

  await expect(sheet.getByText("With Sarah Murray, like the task it’s in")).toBeVisible({
    timeout: 15000,
  });
  await expect(sheet.getByRole("button", { name: /^Share/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Assign" })).toHaveCount(0);
});

test("a subtask of a task shared with you names its owner", async ({ page }) => {
  const data = await mockApi(page);
  const flights = data.tasks[0]!;
  const fares = data.tasks.find((t) => t.title === "Compare Tuesday and Wednesday fares")!;
  for (const t of [flights, fares]) Object.assign(t, { userId: MOCK_SARAH.id, user: MOCK_SARAH });
  flights.shares = [shareWith(flights.id, MOCK_ME)];
  await page.goto(`/task/${fares.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: fares.title, exact: true });

  await expect(sheet.getByText("With Sarah Murray, like the task it’s in")).toBeVisible({
    timeout: 15000,
  });
});

test("a view-only share offers notes and nothing else to change", async ({ page }) => {
  const data = await mockApi(page);
  const restaurant = data.tasks.find((t) => t.title === "Pick a restaurant for Friday")!;
  restaurant.dueDate = "2026-11-06";
  restaurant.shares = restaurant.shares.map((s) => ({ ...(s as object), permission: "view" }));
  await page.goto(`/task/${restaurant.id}`, { waitUntil: "domcontentloaded" });
  const sheet = page.getByRole("dialog", { name: restaurant.title, exact: true });

  await expect(sheet.getByRole("textbox", { name: "Title" })).toHaveAttribute("readonly", "", {
    timeout: 15000,
  });
  await expect(sheet.getByText(/Nov 6/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /^Due date/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Add a date" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Add a subtask" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Add a note" })).toBeVisible();
});
