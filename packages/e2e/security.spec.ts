import { test, expect } from "./fixtures";
import {
  addList,
  addNote,
  addTask,
  apiRequest,
  newList,
  newNote,
  newTask,
  notesOf,
  now,
  send,
  shareTask,
  tasksOf,
  type ApiNote,
} from "./helpers/api";
import { API_URL } from "./helpers/stack";
import { USER_1 } from "./helpers/users";

const EVIL = "https://evil.example";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

test.describe("which sites can call the API", () => {
  test("another site gets no CORS headers; an extension does", async ({ user1Auth }) => {
    const evil = await send("/api/tasks", { token: user1Auth.token, origin: EVIL, base: API_URL });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect(evil.headers.get("access-control-allow-credentials")).toBeNull();

    const extension = await send("/api/tasks", {
      token: user1Auth.token,
      origin: EXTENSION,
      base: API_URL,
    });
    expect(extension.status).toBe(200);
    expect(extension.headers.get("access-control-allow-origin")).toBe(EXTENSION);
    expect(extension.headers.get("access-control-allow-credentials")).toBeNull();
    expect(extension.headers.get("vary")).toMatch(/origin/i);
  });

  test("another site's preflight isn't allowed; an extension's is", async () => {
    const preflight = (origin: string) =>
      send("/api/tasks", { method: "OPTIONS", origin, base: API_URL }).then((res) =>
        res.headers.get("access-control-allow-origin"),
      );
    expect(await preflight(EVIL)).toBeNull();
    expect(await preflight("moz-extension://0d7f4e1c-1b2a-4f5e-9c8d-7a6b5c4d3e2f")).toBe(
      "moz-extension://0d7f4e1c-1b2a-4f5e-9c8d-7a6b5c4d3e2f",
    );
  });

  test("signing in sets no session cookie", async ({ user1Auth }) => {
    const res = await send("/api/auth/login", {
      method: "POST",
      body: { username: user1Auth.username, password: USER_1.password },
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("a cookie doesn't sign a request in", async ({ user1Auth }) => {
    const task = newTask({ title: "Planted" });
    const byCookie = await send("/api/tasks", {
      method: "POST",
      body: task,
      cookie: user1Auth.token,
    });
    expect(byCookie.status).toBe(401);
    expect((await tasksOf(user1Auth.token)).some((t) => t.id === task.id)).toBe(false);
  });
});

test.describe("notes are their author's", () => {
  test("someone else can't edit or delete your note", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const note = await addNote(user1Auth.token, task.id, "Mine");

    const edit = await send("/api/notes", {
      method: "PUT",
      body: { id: note.id, taskId: task.id, content: "Theirs", updatedAt: now() },
      token: user2Auth.token,
    });
    expect(edit.status).toBe(409);
    const remove = await send("/api/notes", {
      method: "DELETE",
      body: { id: note.id },
      token: user2Auth.token,
    });
    expect(remove.status).toBe(404);

    const stored = (await notesOf(user1Auth.token)).find((n) => n.id === note.id);
    expect(stored?.content).toBe("Mine");
  });

  test("the author can still edit and delete it", async ({ user1Auth }) => {
    const task = await addTask(user1Auth.token);
    const note = await addNote(user1Auth.token, task.id, "Draft");
    await apiRequest(
      "PUT",
      "/api/notes",
      // Only what changed, as the app sends an edit
      { id: note.id, content: "Final", updatedAt: now() },
      user1Auth.token,
    );
    expect((await notesOf(user1Auth.token)).find((n) => n.id === note.id)?.content).toBe("Final");
    await apiRequest("DELETE", "/api/notes", { id: note.id }, user1Auth.token);
    expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(false);
  });

  test("no note on a task you can't see", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    const res = await send("/api/notes", {
      method: "POST",
      body: newNote(task.id, "x"),
      token: user2Auth.token,
    });
    // As if the task weren't there, so its id can't be probed
    expect(res.status).toBe(404);
  });

  test("a note on a task shared with you to view", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "view");
    const note = await addNote(user2Auth.token, task.id, "Private thought");
    expect((await notesOf(user2Auth.token)).some((n) => n.id === note.id)).toBe(true);
    expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(false);
  });

  test("reusing someone else's note id doesn't return their note", async ({
    user1Auth,
    user2Auth,
  }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const note = await addNote(user1Auth.token, task.id, "Secret");
    const res = await send("/api/notes", {
      method: "POST",
      body: newNote(task.id, "x", { id: note.id }),
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("Secret");
  });

  test("a retried note comes back after its task was unshared", async ({
    user1Auth,
    user2Auth,
  }) => {
    const task = await addTask(user1Auth.token);
    const shared = await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const body = newNote(task.id, "Kept");
    await apiRequest("POST", "/api/notes", body, user2Auth.token);
    await apiRequest("DELETE", "/api/tasks/share", { id: shared.id }, user1Auth.token);

    // As if the first response was lost and the outbox sent it again
    const retry = await send("/api/notes", { method: "POST", body, token: user2Auth.token });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as ApiNote).id).toBe(body.id);
  });

  test("can't move your note onto a task you can't see", async ({ user1Auth, user2Auth }) => {
    const theirs = await addTask(user1Auth.token);
    const mine = await addTask(user2Auth.token);
    const note = await addNote(user2Auth.token, mine.id, "Mine");
    const res = await send("/api/notes", {
      method: "PUT",
      body: { id: note.id, taskId: theirs.id, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(404);
  });

  test("can't hand your note to someone else", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user2Auth.token);
    const note = await addNote(user2Auth.token, task.id, "Mine");
    const res = await send("/api/notes", {
      method: "PUT",
      body: { id: note.id, taskId: task.id, userId: user1Auth.userId, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(400);
    expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(false);
  });
});

test.describe("what a share lets you change", () => {
  const rename = (taskId: string, token: string) =>
    send("/api/tasks", {
      method: "PUT",
      body: { id: taskId, title: "Renamed", updatedAt: now() },
      token,
    });

  test("a view share can't edit", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token, { title: "Look, don't touch" });
    await shareTask(user1Auth.token, task.id, user2Auth.username, "view");
    expect((await tasksOf(user2Auth.token)).some((t) => t.id === task.id)).toBe(true);

    expect((await rename(task.id, user2Auth.token)).status).toBe(403);
    const done = await send("/api/tasks", {
      method: "PUT",
      body: { id: task.id, status: "done", updatedAt: now() },
      token: user2Auth.token,
    });
    expect(done.status).toBe(403);
    const subtask = await send("/api/tasks", {
      method: "POST",
      body: newTask({ parentId: task.id }),
      token: user2Auth.token,
    });
    expect(subtask.status).toBe(403);

    const stored = (await tasksOf(user1Auth.token)).find((t) => t.id === task.id);
    expect(stored).toMatchObject({ title: "Look, don't touch", status: "todo" });
  });

  test("a view share can still file it in your own list", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "view");
    const list = await addList(user2Auth.token, "Filed");
    const res = await send("/api/tasks/share", {
      method: "PUT",
      body: { taskId: task.id, categoryId: list.id },
      token: user2Auth.token,
    });
    expect(res.status).toBe(200);
  });

  test("not in someone else's list", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const theirList = await addList(user1Auth.token, "Not yours");
    const res = await send("/api/tasks/share", {
      method: "PUT",
      body: { taskId: task.id, categoryId: theirList.id },
      token: user2Auth.token,
    });
    expect(res.status).toBe(403);
  });

  test("an edit share files its share, but can't move the task itself", async ({
    user1Auth,
    user2Auth,
  }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const privateList = await addList(user2Auth.token, "Bob's own");
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: task.id, categoryId: privateList.id, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(403);
  });

  test("a subtask can't be filed in a list of its own", async ({ user1Auth }) => {
    const parent = await addTask(user1Auth.token);
    const subtask = await addTask(user1Auth.token, { parentId: parent.id });
    const list = await addList(user1Auth.token, "Elsewhere");
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: subtask.id, categoryId: list.id, updatedAt: now() },
      token: user1Auth.token,
    });
    expect(res.status).toBe(400);
  });

  test("an edit share can't take the task", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await shareTask(user1Auth.token, task.id, user2Auth.username, "edit");
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: task.id, userId: user2Auth.userId, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(400);
    expect((await tasksOf(user1Auth.token)).find((t) => t.id === task.id)?.userId).toBe(
      user1Auth.userId,
    );
  });
});

test.describe("ids someone else already has", () => {
  test("a task id doesn't bring back their deleted task", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth.token);
    await apiRequest("DELETE", "/api/tasks", { id: task.id }, user1Auth.token);
    const res = await send("/api/tasks", {
      method: "POST",
      body: newTask({ id: task.id }),
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect((await tasksOf(user1Auth.token)).some((t) => t.id === task.id)).toBe(false);
  });

  test("a list id doesn't return their list", async ({ user1Auth, user2Auth }) => {
    const list = await addList(user1Auth.token, "Hidden name");
    const res = await send("/api/categories", {
      method: "POST",
      body: newList("Mine", { id: list.id }),
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("Hidden name");
  });
});

test("a token in the URL signs in only the event stream", async ({ user1Auth }) => {
  const res = await send(`/api/tasks?token=${user1Auth.token}`);
  expect(res.status).toBe(401);
});
