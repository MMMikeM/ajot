import { test, expect } from "./fixtures";
import { apiRequest } from "./helpers/api";
import type { AuthResult } from "./helpers/auth";
import { API_PORT, BASE_URL } from "./helpers/stack";
import { USER_1 } from "./helpers/users";

// Only the server is under test, so one browser project is enough
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "server-only checks");
});

// Straight to the API, so these are the server's own CORS headers and not the preview server's
const API_URL = `http://localhost:${API_PORT}`;
const EVIL = "https://evil.example";
const EXTENSION = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

type Note = { id: string; content: string | null; taskId: string | null; userId: string };
type Task = { id: string; title: string; status: string; userId: string };

type Send = {
  method?: string;
  body?: unknown;
  token?: string;
  cookie?: string;
  origin?: string;
  base?: string;
};

const send = (path: string, { method = "GET", body, token, cookie, origin, base }: Send) =>
  fetch(`${base ?? API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(cookie && { Cookie: `auth=${cookie}` }),
      ...(origin && { Origin: origin }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const newTask = (extra: Record<string, unknown> = {}) => ({
  id: id(),
  userId: "",
  title: "Security check",
  createdAt: now(),
  updatedAt: now(),
  ...extra,
});

const addTask = (auth: AuthResult, extra: Record<string, unknown> = {}) =>
  apiRequest<Task>("POST", "/api/tasks", newTask(extra), auth.token);

const addNote = (auth: AuthResult, taskId: string, content: string) =>
  apiRequest<Note>(
    "POST",
    "/api/notes",
    { id: id(), userId: "", taskId, title: content, content, createdAt: now(), updatedAt: now() },
    auth.token,
  );

const share = (owner: AuthResult, taskId: string, to: AuthResult, permission: "view" | "edit") =>
  apiRequest<{ id: string }>(
    "POST",
    "/api/tasks/share",
    { taskId, username: to.username, permission },
    owner.token,
  );

const tasksOf = (auth: AuthResult) =>
  apiRequest<Task[]>("GET", "/api/tasks", undefined, auth.token);
const notesOf = (auth: AuthResult) =>
  apiRequest<Note[]>("GET", "/api/notes", undefined, auth.token);

test.describe("which sites can call the API", () => {
  test("another site gets no CORS headers; an extension does", async ({ user1Auth }) => {
    const evil = await send("/api/tasks", { token: user1Auth.token, origin: EVIL });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect(evil.headers.get("access-control-allow-credentials")).toBeNull();

    const extension = await send("/api/tasks", { token: user1Auth.token, origin: EXTENSION });
    expect(extension.status).toBe(200);
    expect(extension.headers.get("access-control-allow-origin")).toBe(EXTENSION);
    expect(extension.headers.get("access-control-allow-credentials")).toBeNull();
    expect(extension.headers.get("vary")).toMatch(/origin/i);
  });

  test("another site's preflight isn't allowed; an extension's is", async () => {
    const preflight = (origin: string) =>
      send("/api/tasks", { method: "OPTIONS", origin }).then((res) =>
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
      origin: API_URL,
    });
    expect(byCookie.status).toBe(401);
    expect((await tasksOf(user1Auth)).some((t) => t.id === task.id)).toBe(false);
  });

  test("the app's own writes still work", async ({ user1Auth }) => {
    const direct = newTask({ title: "Own origin" });
    const res = await send("/api/tasks", {
      method: "POST",
      body: direct,
      token: user1Auth.token,
      origin: API_URL,
    });
    expect(res.status).toBe(200);

    // Through the preview server's proxy, as the PWA calls it in the suite
    const proxied = newTask({ title: "Through the proxy" });
    const viaProxy = await send("/api/tasks", {
      method: "POST",
      body: proxied,
      token: user1Auth.token,
      origin: new URL(BASE_URL).origin,
      base: BASE_URL,
    });
    expect(viaProxy.status).toBe(200);

    const ids = (await tasksOf(user1Auth)).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([direct.id, proxied.id]));
  });

  test("an extension's writes still work", async ({ user1Auth }) => {
    const res = await send("/api/tasks", {
      method: "POST",
      body: newTask({ title: "From the extension" }),
      token: user1Auth.token,
      origin: EXTENSION,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXTENSION);
  });
});

test.describe("notes are their author's", () => {
  test("someone else can't edit or delete your note", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    const note = await addNote(user1Auth, task.id, "Mine");

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

    const stored = (await notesOf(user1Auth)).find((n) => n.id === note.id);
    expect(stored?.content).toBe("Mine");
  });

  test("the author can still edit and delete it", async ({ user1Auth }) => {
    const task = await addTask(user1Auth);
    const note = await addNote(user1Auth, task.id, "Draft");
    await apiRequest(
      "PUT",
      "/api/notes",
      // Only what changed, as the app sends an edit
      { id: note.id, content: "Final", updatedAt: now() },
      user1Auth.token,
    );
    expect((await notesOf(user1Auth)).find((n) => n.id === note.id)?.content).toBe("Final");
    await apiRequest("DELETE", "/api/notes", { id: note.id }, user1Auth.token);
    expect((await notesOf(user1Auth)).some((n) => n.id === note.id)).toBe(false);
  });

  test("no note on a task you can't see", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    const res = await send("/api/notes", {
      method: "POST",
      body: {
        id: id(),
        userId: "",
        taskId: task.id,
        title: "x",
        createdAt: now(),
        updatedAt: now(),
      },
      token: user2Auth.token,
    });
    // As if the task weren't there, so its id can't be probed
    expect(res.status).toBe(404);
  });

  test("a note on a task shared with you to view", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "view");
    const note = await addNote(user2Auth, task.id, "Private thought");
    expect((await notesOf(user2Auth)).some((n) => n.id === note.id)).toBe(true);
    expect((await notesOf(user1Auth)).some((n) => n.id === note.id)).toBe(false);
  });

  test("reusing someone else's note id doesn't return their note", async ({
    user1Auth,
    user2Auth,
  }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    const note = await addNote(user1Auth, task.id, "Secret");
    const res = await send("/api/notes", {
      method: "POST",
      body: {
        id: note.id,
        userId: "",
        taskId: task.id,
        title: "x",
        createdAt: now(),
        updatedAt: now(),
      },
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("Secret");
  });

  test("a retried note comes back after its task was unshared", async ({
    user1Auth,
    user2Auth,
  }) => {
    const task = await addTask(user1Auth);
    const shared = await share(user1Auth, task.id, user2Auth, "edit");
    const note = { id: id(), userId: "", taskId: task.id, title: "Kept", content: "Kept" };
    const body = { ...note, createdAt: now(), updatedAt: now() };
    await apiRequest("POST", "/api/notes", body, user2Auth.token);
    await apiRequest("DELETE", "/api/tasks/share", { id: shared.id }, user1Auth.token);

    // As if the first response was lost and the outbox sent it again
    const retry = await send("/api/notes", { method: "POST", body, token: user2Auth.token });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Note).id).toBe(note.id);
  });

  test("can't move your note onto a task you can't see", async ({ user1Auth, user2Auth }) => {
    const theirs = await addTask(user1Auth);
    const mine = await addTask(user2Auth);
    const note = await addNote(user2Auth, mine.id, "Mine");
    const res = await send("/api/notes", {
      method: "PUT",
      body: { id: note.id, taskId: theirs.id, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(404);
  });

  test("can't hand your note to someone else", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user2Auth);
    const note = await addNote(user2Auth, task.id, "Mine");
    const res = await send("/api/notes", {
      method: "PUT",
      body: { id: note.id, taskId: task.id, userId: user1Auth.userId, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(400);
    expect((await notesOf(user1Auth)).some((n) => n.id === note.id)).toBe(false);
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
    const task = await addTask(user1Auth, { title: "Look, don't touch" });
    await share(user1Auth, task.id, user2Auth, "view");
    expect((await tasksOf(user2Auth)).some((t) => t.id === task.id)).toBe(true);

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

    const stored = (await tasksOf(user1Auth)).find((t) => t.id === task.id);
    expect(stored).toMatchObject({ title: "Look, don't touch", status: "todo" });
  });

  test("a view share can still file it in your own list", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "view");
    const list = await apiRequest<{ id: string }>(
      "POST",
      "/api/categories",
      { id: id(), userId: "", name: "Filed", createdAt: now(), updatedAt: now() },
      user2Auth.token,
    );
    const res = await send("/api/tasks/share", {
      method: "PUT",
      body: { taskId: task.id, categoryId: list.id },
      token: user2Auth.token,
    });
    expect(res.status).toBe(200);
  });

  test("not in someone else's list", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    const theirList = await apiRequest<{ id: string }>(
      "POST",
      "/api/categories",
      { id: id(), userId: "", name: "Not yours", createdAt: now(), updatedAt: now() },
      user1Auth.token,
    );
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
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    const privateList = await apiRequest<{ id: string }>(
      "POST",
      "/api/categories",
      { id: id(), userId: "", name: "Bob's own", createdAt: now(), updatedAt: now() },
      user2Auth.token,
    );
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: task.id, categoryId: privateList.id, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(403);
  });

  test("a subtask can't be filed in a list of its own", async ({ user1Auth }) => {
    const parent = await addTask(user1Auth);
    const subtask = await addTask(user1Auth, { parentId: parent.id });
    const list = await apiRequest<{ id: string }>(
      "POST",
      "/api/categories",
      { id: id(), userId: "", name: "Elsewhere", createdAt: now(), updatedAt: now() },
      user1Auth.token,
    );
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: subtask.id, categoryId: list.id, updatedAt: now() },
      token: user1Auth.token,
    });
    expect(res.status).toBe(400);
  });

  test("an edit share can edit", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    expect((await rename(task.id, user2Auth.token)).status).toBe(200);
    expect((await tasksOf(user1Auth)).find((t) => t.id === task.id)?.title).toBe("Renamed");
  });

  test("an edit share can't take the task", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await share(user1Auth, task.id, user2Auth, "edit");
    const res = await send("/api/tasks", {
      method: "PUT",
      body: { id: task.id, userId: user2Auth.userId, updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(400);
    expect((await tasksOf(user1Auth)).find((t) => t.id === task.id)?.userId).toBe(user1Auth.userId);
  });
});

test.describe("ids someone else already has", () => {
  test("a task id doesn't bring back their deleted task", async ({ user1Auth, user2Auth }) => {
    const task = await addTask(user1Auth);
    await apiRequest("DELETE", "/api/tasks", { id: task.id }, user1Auth.token);
    const res = await send("/api/tasks", {
      method: "POST",
      body: newTask({ id: task.id }),
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect((await tasksOf(user1Auth)).some((t) => t.id === task.id)).toBe(false);
  });

  test("a list id doesn't return their list", async ({ user1Auth, user2Auth }) => {
    const list = await apiRequest<{ id: string }>(
      "POST",
      "/api/categories",
      { id: id(), userId: "", name: "Hidden name", createdAt: now(), updatedAt: now() },
      user1Auth.token,
    );
    const res = await send("/api/categories", {
      method: "POST",
      body: { id: list.id, userId: "", name: "Mine", createdAt: now(), updatedAt: now() },
      token: user2Auth.token,
    });
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain("Hidden name");
  });
});

test("a token in the URL signs in only the event stream", async ({ user1Auth }) => {
  const res = await send(`/api/tasks?token=${user1Auth.token}`, {});
  expect(res.status).toBe(401);
});
