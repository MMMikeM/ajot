import { test, expect } from "./fixtures";
import {
  addCollaborator,
  addList,
  addTask,
  apiRequest,
  newId,
  now,
  shareTask,
  tasksOf,
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

  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  const sheet = page.getByRole("dialog", { name: title });
  await page.context().setOffline(true);
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await sheet
    .getByRole("group", { name: "Add to task" })
    .getByRole("button", { name: "List" })
    .click();
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
