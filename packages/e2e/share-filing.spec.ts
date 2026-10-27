import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { addField, startsWith } from "./helpers/app";
import type { AuthResult } from "./helpers/auth";
import {
  addCollaborator,
  addList,
  addTask,
  apiRequest,
  newId,
  now,
  shareTask,
  tasksOf,
  type ApiTask,
} from "./helpers/api";

test("a task shared with you, filed offline, reaches the server once back online", async ({
  user1Auth,
  user2Auth,
  user2Page: page,
}) => {
  const title = `File me ${newId().slice(0, 8)}`;
  const task = await addTask(user1Auth.token, { title });
  await shareTask(user1Auth.token, task.id, user2Auth.username);
  const list = await addList(user2Auth.token, "Bob's own");
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: startsWith(title) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await page.context().setOffline(true);
  await addField(sheet, "List");
  await page.getByRole("option", { name: "Bob's own" }).click();
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveText("Bob's own");

  await page.context().setOffline(false);
  const filedUnder = async () =>
    (await tasksOf(user2Auth.token))
      .find((t) => t.id === task.id)
      ?.shares.find((s) => s.sharedWithUserId === user2Auth.userId)?.categoryId;
  await expect.poll(filedUnder, { timeout: 15_000 }).toBe(list.id);
});

test("a task moved into a list you share reaches you without a reload", async ({
  user1Auth,
  user2Auth,
  user2Page: page,
}) => {
  const list = await addList(user1Auth.token, `Ours ${newId().slice(0, 8)}`);
  await addCollaborator(user1Auth.token, list.id, user2Auth.username);
  const title = `Moved in ${newId().slice(0, 8)}`;
  const task = await addTask(user1Auth.token, { title });
  await addTask(user1Auth.token, { title: `${title}, its subtask`, parentId: task.id });
  await page.goto(`/list/${list.id}`);
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Ours");

  await apiRequest(
    "PUT",
    "/api/tasks",
    { id: task.id, categoryId: list.id, updatedAt: now() },
    user1Auth.token,
  );
  await expect(page.locator("[data-task-id]", { hasText: title }).first()).toBeVisible();
});

const sidebar = (page: Page) => page.getByTestId("category-sidebar");
const pill = (page: Page, name: string) =>
  sidebar(page).getByRole("button", { name: startsWith(name) });
const inbox = (page: Page) => sidebar(page).getByRole("button", { name: /^Inbox/ });
const rowOf = (page: Page, title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

/** Every list in the sidebar, which is where a task can be dropped. */
const sidebarLists = async (page: Page) =>
  (
    await sidebar(page)
      .locator("span.truncate[title]")
      .evaluateAll((spans) => spans.map((s) => s.getAttribute("title") ?? ""))
  ).sort();

/** Opens the sheet's List picker, and reads what it offers besides the Inbox. */
const offeredLists = async (page: Page, sheet: Locator) => {
  await addField(sheet, "List");
  await expect(page.getByRole("option").first()).toBeVisible();
  return (await page.getByRole("option").allTextContents()).filter((o) => o !== "Inbox").sort();
};

// Presses and moves in small steps; dnd-kit picks the row up once it has moved 5px
const dragOnto = async (page: Page, title: string, target: Locator) => {
  const from = (await page.getByRole("button", { name: startsWith(title) }).boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
};

const roles = [
  {
    who: "your own task",
    add: (_alice: AuthResult, bob: AuthResult, title: string) => addTask(bob.token, { title }),
    listOf: (task: ApiTask) => task.categoryId,
  },
  {
    who: "a task shared with you",
    add: async (alice: AuthResult, bob: AuthResult, title: string) => {
      const task = await addTask(alice.token, { title });
      await shareTask(alice.token, task.id, bob.username);
      return task;
    },
    listOf: (task: ApiTask, bob: AuthResult) =>
      task.shares.find((s) => s.sharedWithUserId === bob.userId)?.categoryId,
  },
];

for (const role of roles)
  test(`${role.who}: the sheet offers the lists a drag accepts, and both move it offline`, async ({
    user1Auth: alice,
    user2Auth: bob,
    user2Page: page,
  }) => {
    const id = newId().slice(0, 8);
    const mine = `Bob's ${id}`;
    const ours = `Ours ${id}`;
    await addList(bob.token, mine);
    const ourList = await addList(alice.token, ours);
    await addCollaborator(alice.token, ourList.id, bob.username);
    const notMine = `Alice's ${id}`;
    await addList(alice.token, notMine);
    const title = `Move me ${id}`;
    const task = await role.add(alice, bob, title);
    await page.reload({ waitUntil: "domcontentloaded" });
    await inbox(page).click();
    await expect(rowOf(page, title)).toBeVisible();

    const droppable = await sidebarLists(page);
    expect(droppable).toEqual(expect.arrayContaining([mine, ours]));
    expect(droppable).not.toContain(notMine);

    await page.context().setOffline(true);
    await page.getByRole("button", { name: startsWith(title) }).click();
    const sheet = page.getByRole("dialog", { name: title });
    expect(await offeredLists(page, sheet)).toEqual(droppable);
    await page.getByRole("option", { name: mine }).click();
    await expect(sheet.getByRole("combobox", { name: "List" })).toHaveText(mine);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(rowOf(page, title)).toHaveCount(0);

    await pill(page, mine).click();
    await expect(rowOf(page, title)).toBeVisible();
    await dragOnto(page, title, pill(page, ours));
    await expect(rowOf(page, title)).toHaveCount(0);
    await pill(page, ours).click();
    await expect(rowOf(page, title)).toBeVisible();

    await page.context().setOffline(false);
    const filedUnder = async () => {
      const saved = (await tasksOf(bob.token)).find((t) => t.id === task.id)!;
      return role.listOf(saved, bob);
    };
    await expect.poll(filedUnder, { timeout: 15_000 }).toBe(ourList.id);
  });

test("in someone else's list you're in, neither the sheet nor a drag moves it, shared with you or not", async ({
  user1Auth: alice,
  user2Auth: bob,
  user2Page: page,
}) => {
  const id = newId().slice(0, 8);
  const mine = `Bob's ${id}`;
  await addList(bob.token, mine);
  const ourList = await addList(alice.token, `Ours ${id}`);
  await addCollaborator(alice.token, ourList.id, bob.username);
  const titles = [`Alice's ${id}`, `Alice's, shared ${id}`];
  const [, shared] = await Promise.all(
    titles.map((title) => addTask(alice.token, { title, categoryId: ourList.id })),
  );
  await shareTask(alice.token, shared!.id, bob.username);
  await page.goto(`/list/${ourList.id}`);
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Ours");

  await page.context().setOffline(true);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/tasks"))
      writes.push(request.url());
  });
  for (const title of titles) {
    await page.getByRole("button", { name: startsWith(title) }).click();
    const sheet = page.getByRole("dialog", { name: title });
    await expect(sheet.getByText(`Ours ${id}`, { exact: true })).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "List" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await dragOnto(page, title, pill(page, mine));
    await expect(page.getByText("Only its owner can move this task.").first()).toBeVisible();
    await expect(rowOf(page, title)).toBeVisible();
  }

  await page.context().setOffline(false);
  // Long enough for anything queued offline to have been sent
  await page.waitForTimeout(2_000);
  const tasks = await tasksOf(bob.token);
  for (const title of titles) {
    const task = tasks.find((t) => t.title === title)!;
    expect(task.categoryId).toBe(ourList.id);
    expect(task.shares.every((s) => s.categoryId === null)).toBe(true);
  }
  expect(writes).toEqual([]);
});

test("a task in your own list stays there, even when it's also shared with you", async ({
  user1Auth: alice,
  user2Auth: bob,
  user1Page: page,
}) => {
  const id = newId().slice(0, 8);
  const ourList = await addList(alice.token, `Ours ${id}`);
  await addCollaborator(alice.token, ourList.id, bob.username);
  const title = `Bob's, shared with Alice ${id}`;
  const task = await addTask(bob.token, { title, categoryId: ourList.id });
  await shareTask(bob.token, task.id, alice.username);
  await page.reload({ waitUntil: "domcontentloaded" });

  await inbox(page).click();
  await expect(pill(page, `Ours ${id}`)).toBeVisible();
  await expect(rowOf(page, title)).toHaveCount(0);
  await pill(page, `Ours ${id}`).click();
  await page.getByRole("button", { name: startsWith(title) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet.getByText(`Ours ${id}`, { exact: true })).toBeVisible();
  await expect(sheet.getByRole("combobox", { name: "List" })).toHaveCount(0);
});
