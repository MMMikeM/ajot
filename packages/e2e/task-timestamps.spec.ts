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
