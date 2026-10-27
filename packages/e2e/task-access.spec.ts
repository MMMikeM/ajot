import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";
import { BASE_URL } from "./helpers/stack";

// Only the server is under test, so one browser project is enough
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "server-only checks");
});

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

/** The status of a request, where apiRequest would throw on anything but 2xx */
const status = async (method: string, path: string, body: unknown, token: string) =>
  (
    await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  ).status;

const newTask = (extra: Record<string, unknown> = {}) => ({
  id: id(),
  userId: "",
  title: "Access check",
  createdAt: now(),
  updatedAt: now(),
  ...extra,
});

const addTaskAs = async (token: string) =>
  apiRequest<{ id: string }>("POST", "/api/tasks", newTask(), token);

const newList = async (token: string, name: string) =>
  apiRequest<{ id: string }>(
    "POST",
    "/api/categories",
    { id: id(), userId: "", name, createdAt: now(), updatedAt: now() },
    token,
  );

test.describe("which lists and tasks you can add to or edit", () => {
  test("not someone else's private list", async ({ user1Auth, user2Auth }) => {
    const list = await newList(user1Auth.token, "Private");
    expect(
      await status("POST", "/api/tasks", newTask({ categoryId: list.id }), user2Auth.token),
    ).toBe(403);
  });

  test("a list shared with you", async ({ user1Auth, user2Auth }) => {
    const list = await newList(user1Auth.token, "Shared");
    await apiRequest(
      "POST",
      `/api/categories/${list.id}/collaborators`,
      { username: user2Auth.username },
      user1Auth.token,
    );
    expect(
      await status("POST", "/api/tasks", newTask({ categoryId: list.id }), user2Auth.token),
    ).toBe(200);
  });

  test("not a subtask under someone else's task", async ({ user1Auth, user2Auth }) => {
    const parent = await addTaskAs(user1Auth.token);
    expect(
      await status("POST", "/api/tasks", newTask({ parentId: parent.id }), user2Auth.token),
    ).toBe(404);
  });

  test("a subtask under a task shared with you", async ({ user1Auth, user2Auth }) => {
    const parent = await addTaskAs(user1Auth.token);
    await apiRequest(
      "POST",
      "/api/tasks/share",
      { taskId: parent.id, username: user2Auth.username },
      user1Auth.token,
    );
    expect(
      await status("POST", "/api/tasks", newTask({ parentId: parent.id }), user2Auth.token),
    ).toBe(200);
  });

  test("editing a task shared with you", async ({ user1Auth, user2Auth }) => {
    const shared = await addTaskAs(user1Auth.token);
    await apiRequest(
      "POST",
      "/api/tasks/share",
      { taskId: shared.id, username: user2Auth.username },
      user1Auth.token,
    );
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
    const theirs = await addTaskAs(user1Auth.token);
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
    const list = await newList(user1Auth.token, "Not yours");
    const mine = await addTaskAs(user2Auth.token);
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
