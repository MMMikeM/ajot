import { test, expect } from "./fixtures";
import { createTask } from "./helpers/app";
import { apiRequest } from "./helpers/api";

type Task = {
  id: string;
  title: string;
  parentId: string | null;
  status: string;
  updatedAt: string;
  editedAt: string | null;
  completedAt: string | null;
};
type Note = { id: string; taskId: string };

test.beforeEach(async ({ user1Auth }) => {
  const tasks = await apiRequest<Task[]>("GET", "/api/tasks", undefined, user1Auth.token);
  await Promise.allSettled(
    tasks
      .filter((t) => !t.parentId)
      .map((t) => apiRequest("DELETE", "/api/tasks", { id: t.id }, user1Auth.token)),
  );
});

const serverTask = async (token: string, title: string) => {
  const tasks = await apiRequest<Task[]>("GET", "/api/tasks", undefined, token);
  return tasks.find((t) => t.title === title);
};

const serverNotes = (token: string) => apiRequest<Note[]>("GET", "/api/notes", undefined, token);

const row = (page: Parameters<typeof createTask>[0], title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

test("ticking stamps completedAt and unticking clears it, without counting as an edit", async ({
  user1Page: page,
  user1Auth,
}) => {
  await createTask(page, "Water the plants");
  await expect.poll(() => serverTask(user1Auth.token, "Water the plants")).toBeTruthy();

  await row(page, "Water the plants").getByRole("checkbox").first().click();
  await expect
    .poll(async () => (await serverTask(user1Auth.token, "Water the plants"))?.completedAt)
    .toBeTruthy();
  expect((await serverTask(user1Auth.token, "Water the plants"))?.editedAt).toBeNull();

  await page.getByRole("button", { name: /done/i }).first().click();
  await row(page, "Water the plants").getByRole("checkbox").first().click();
  await expect
    .poll(async () => (await serverTask(user1Auth.token, "Water the plants"))?.completedAt)
    .toBeNull();
});

test("a client that sends no stamps still gets them from the server", async ({ user1Auth }) => {
  const at = new Date().toISOString();
  const created = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    {
      id: `stamps-${Date.now()}`,
      userId: user1Auth.userId,
      title: "Old client",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  expect(created.editedAt).toBeNull();
  expect(created.completedAt).toBeNull();

  const later = new Date().toISOString();
  const renamed = await apiRequest<Task>(
    "PUT",
    "/api/tasks",
    { id: created.id, title: "Old client, renamed", status: "done", updatedAt: later },
    user1Auth.token,
  );
  expect(renamed.editedAt).toBe(later);
  expect(renamed.completedAt).toBe(later);
});

test("adding a note or a subtask marks the task edited", async ({ user1Auth }) => {
  const at = new Date().toISOString();
  const task = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    {
      id: `edited-${Date.now()}`,
      userId: user1Auth.userId,
      title: "Plan the trip",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );

  const noteAt = new Date().toISOString();
  await apiRequest(
    "POST",
    "/api/notes",
    {
      id: `note-${Date.now()}`,
      userId: user1Auth.userId,
      taskId: task.id,
      title: "Window seat",
      content: "Window seat",
      createdAt: noteAt,
      updatedAt: noteAt,
    },
    user1Auth.token,
  );
  expect((await serverTask(user1Auth.token, "Plan the trip"))?.editedAt).toBe(noteAt);

  const subtaskAt = new Date().toISOString();
  await apiRequest(
    "POST",
    "/api/tasks",
    {
      id: `sub-${Date.now()}`,
      userId: user1Auth.userId,
      parentId: task.id,
      title: "Book the hotel",
      createdAt: subtaskAt,
      updatedAt: subtaskAt,
    },
    user1Auth.token,
  );
  const parent = await serverTask(user1Auth.token, "Plan the trip");
  expect(parent?.editedAt).toBe(subtaskAt);
  // The sync clock is left alone, so an older pending edit to the task still lands
  expect(parent?.updatedAt).toBe(at);
});

test("Undo brings back a note deleted on its own", async ({ user1Page: page, user1Auth }) => {
  await createTask(page, "Book the vet");
  await expect.poll(() => serverTask(user1Auth.token, "Book the vet")).toBeTruthy();
  const task = (await serverTask(user1Auth.token, "Book the vet"))!;
  const at = new Date().toISOString();
  const noteId = `note-${Date.now()}`;
  await apiRequest(
    "POST",
    "/api/notes",
    {
      id: noteId,
      userId: user1Auth.userId,
      taskId: task.id,
      title: "Ask about the jab",
      content: "Ask about the jab",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  await page.reload();

  await row(page, "Book the vet").getByRole("button", { name: "Book the vet" }).click();
  const note = page.locator('[data-slot="drawer-content"] .group\\/row', {
    hasText: "Ask about the jab",
  });
  await note.hover();
  await note.getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () => (await serverNotes(user1Auth.token)).some((n) => n.id === noteId))
    .toBe(false);

  await page.locator("[data-toast-undo]").getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await serverNotes(user1Auth.token)).some((n) => n.id === noteId))
    .toBe(true);
});
