import { test, expect } from "./fixtures";
import {
  addCollaborator,
  addList,
  addTask,
  newTask,
  now,
  send,
  shareTask,
  tasksOf,
} from "./helpers/api";

const status = async (method: string, path: string, body: unknown, token: string) =>
  (await send(path, { method, body, token })).status;

test.describe("which lists and tasks you can add to or edit", () => {
  test("not someone else's private list", async ({ user1Auth, user2Auth }) => {
    const list = await addList(user1Auth.token, "Private");
    expect(
      await status("POST", "/api/tasks", newTask({ categoryId: list.id }), user2Auth.token),
    ).toBe(403);
  });

  test("a list shared with you", async ({ user1Auth, user2Auth }) => {
    const list = await addList(user1Auth.token, "Shared");
    await addCollaborator(user1Auth.token, list.id, user2Auth.username);
    expect(
      await status("POST", "/api/tasks", newTask({ categoryId: list.id }), user2Auth.token),
    ).toBe(200);
  });

  test("not a subtask under someone else's task", async ({ user1Auth, user2Auth }) => {
    const parent = await addTask(user1Auth.token);
    expect(
      await status("POST", "/api/tasks", newTask({ parentId: parent.id }), user2Auth.token),
    ).toBe(404);
  });

  test("its owner sees and edits a task a collaborator added to their list", async ({
    user1Auth,
    user2Auth,
  }) => {
    const list = await addList(user1Auth.token, "Ours");
    await addCollaborator(user1Auth.token, list.id, user2Auth.username);
    const theirs = await addTask(user2Auth.token, { categoryId: list.id });
    expect((await tasksOf(user1Auth.token)).some((t) => t.id === theirs.id)).toBe(true);
    expect(
      await status(
        "PUT",
        "/api/tasks",
        { id: theirs.id, status: "done", updatedAt: now() },
        user1Auth.token,
      ),
    ).toBe(200);
  });

  test("not moving a task in a list you collaborate on", async ({ user1Auth, user2Auth }) => {
    const list = await addList(user1Auth.token, "Theirs to arrange");
    await addCollaborator(user1Auth.token, list.id, user2Auth.username);
    const task = await addTask(user1Auth.token, { categoryId: list.id });
    const move = (categoryId: string | null) =>
      status("PUT", "/api/tasks", { id: task.id, categoryId, updatedAt: now() }, user2Auth.token);
    expect(await move(null)).toBe(403);
    expect(await move((await addList(user2Auth.token, "Bob's")).id)).toBe(403);
  });

  test("a subtask under a task shared with you", async ({ user1Auth, user2Auth }) => {
    const parent = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, parent.id, user2Auth.username);
    expect(
      await status("POST", "/api/tasks", newTask({ parentId: parent.id }), user2Auth.token),
    ).toBe(200);
  });

  test("editing a task shared with you", async ({ user1Auth, user2Auth }) => {
    const shared = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, shared.id, user2Auth.username);
    expect(
      await status(
        "PUT",
        "/api/tasks",
        { id: shared.id, status: "done", updatedAt: now() },
        user2Auth.token,
      ),
    ).toBe(200);
  });

  test("not editing someone else's task", async ({ user1Auth, user2Auth }) => {
    const theirs = await addTask(user1Auth.token);
    expect(
      await status(
        "PUT",
        "/api/tasks",
        { id: theirs.id, status: "done", updatedAt: now() },
        user2Auth.token,
      ),
    ).toBe(404);
  });

  test("not moving your task into someone else's list", async ({ user1Auth, user2Auth }) => {
    const list = await addList(user1Auth.token, "Not yours");
    const mine = await addTask(user2Auth.token);
    expect(
      await status(
        "PUT",
        "/api/tasks",
        { id: mine.id, categoryId: list.id, updatedAt: now() },
        user2Auth.token,
      ),
    ).toBe(403);
  });
});
