import { test, expect } from "./fixtures";
import { createTask } from "./helpers/app";
import { apiRequest, ensureMutualContacts } from "./helpers/api";

type Task = {
  id: string;
  title: string;
  parentId: string | null;
  categoryId: string | null;
  shares: { sharedWithUserId: string }[];
};
type Note = { id: string; taskId: string | null };

test.beforeEach(async ({ user1Auth }) => {
  const tasks = await apiRequest<Task[]>("GET", "/api/tasks", undefined, user1Auth.token);
  await Promise.allSettled(
    tasks
      .filter((t) => !t.parentId)
      .map((t) => apiRequest("DELETE", "/api/tasks", { id: t.id }, user1Auth.token)),
  );
});

const tasksOf = (token: string) => apiRequest<Task[]>("GET", "/api/tasks", undefined, token);
const notesOf = (token: string) => apiRequest<Note[]>("GET", "/api/notes", undefined, token);
const findTask = async (token: string, title: string) =>
  (await tasksOf(token)).find((t) => t.title === title);

const addNote = (auth: { token: string; userId: string }, taskId: string, text: string) => {
  const at = new Date().toISOString();
  return apiRequest<Note>(
    "POST",
    "/api/notes",
    {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: auth.userId,
      taskId,
      title: text,
      content: text,
      createdAt: at,
      updatedAt: at,
    },
    auth.token,
  );
};

const row = (page: Parameters<typeof createTask>[0], title: string) =>
  page.locator("[data-task-id]", { hasText: title }).first();

test("deleting hides a task and its notes from everyone, and Undo brings it all back", async ({
  user1Page: page,
  user1Auth,
  user2Auth,
}) => {
  await ensureMutualContacts(user1Auth.token, user2Auth.token);
  await createTask(page, "Renew passport");
  await expect.poll(() => findTask(user1Auth.token, "Renew passport")).toBeTruthy();
  const task = (await findTask(user1Auth.token, "Renew passport"))!;
  await apiRequest(
    "POST",
    "/api/tasks/share",
    { taskId: task.id, username: user2Auth.username },
    user1Auth.token,
  );
  const mine = await addNote(user1Auth, task.id, "Photo booth");
  const theirs = await addNote(user2Auth, task.id, "Bring the old one");
  await page.reload();

  await row(page, "Renew passport").hover();
  await row(page, "Renew passport").getByRole("button", { name: "Delete task" }).click();
  await expect.poll(() => findTask(user1Auth.token, "Renew passport")).toBeUndefined();
  expect(await findTask(user2Auth.token, "Renew passport")).toBeUndefined();
  expect((await notesOf(user1Auth.token)).some((n) => n.id === mine.id)).toBe(false);
  expect((await notesOf(user2Auth.token)).some((n) => n.id === theirs.id)).toBe(false);

  await page.locator("[data-toast-undo]").getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => findTask(user1Auth.token, "Renew passport")).toBeTruthy();
  const restored = (await findTask(user1Auth.token, "Renew passport"))!;
  expect(restored.shares.map((s) => s.sharedWithUserId)).toEqual([user2Auth.userId]);
  expect(await findTask(user2Auth.token, "Renew passport")).toBeTruthy();
  expect((await notesOf(user1Auth.token)).some((n) => n.id === mine.id)).toBe(true);
  expect((await notesOf(user2Auth.token)).some((n) => n.id === theirs.id)).toBe(true);
});

test("only the owner can restore, and a deleted task can't be edited", async ({
  user1Auth,
  user2Auth,
}) => {
  await ensureMutualContacts(user1Auth.token, user2Auth.token);
  const at = new Date().toISOString();
  const task = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    {
      id: `owned-${Date.now()}`,
      userId: user1Auth.userId,
      title: "Owned",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  await apiRequest(
    "POST",
    "/api/tasks/share",
    { taskId: task.id, username: user2Auth.username },
    user1Auth.token,
  );
  await apiRequest("DELETE", "/api/tasks", { id: task.id }, user1Auth.token);

  const later = new Date(Date.now() + 1000).toISOString();
  await expect(
    apiRequest(
      "PUT",
      "/api/tasks",
      { id: task.id, title: "Edited", updatedAt: later },
      user1Auth.token,
    ),
  ).rejects.toThrow(/404/);
  await expect(
    apiRequest(
      "PUT",
      "/api/tasks",
      { id: task.id, deletedAt: null, updatedAt: later },
      user2Auth.token,
    ),
  ).rejects.toThrow(/403/);
  // A device whose clock runs behind the server's still gets its Undo
  const behind = new Date(Date.now() - 60_000).toISOString();
  await apiRequest(
    "PUT",
    "/api/tasks",
    { id: task.id, deletedAt: null, updatedAt: behind },
    user1Auth.token,
  );
  expect(await findTask(user1Auth.token, "Owned")).toBeTruthy();
});

test("an Undo from before restores existed still brings the task back", async ({ user1Auth }) => {
  const at = new Date().toISOString();
  const body = {
    id: `legacy-${Date.now()}`,
    userId: user1Auth.userId,
    title: "Legacy",
    createdAt: at,
    updatedAt: at,
  };
  await apiRequest("POST", "/api/tasks", body, user1Auth.token);
  await apiRequest("DELETE", "/api/tasks", { id: body.id }, user1Auth.token);
  await apiRequest("POST", "/api/tasks", body, user1Auth.token);
  expect(await findTask(user1Auth.token, "Legacy")).toBeTruthy();
});

test("deleting a list hides its tasks and their notes, and they can come back to the Inbox", async ({
  user1Auth,
}) => {
  const at = new Date().toISOString();
  const listId = crypto.randomUUID();
  await apiRequest(
    "POST",
    "/api/categories",
    {
      id: listId,
      userId: user1Auth.userId,
      name: `Trip ${Date.now()}`,
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  const task = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    {
      id: `in-list-${Date.now()}`,
      userId: user1Auth.userId,
      categoryId: listId,
      title: "Pack",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  const note = await addNote(user1Auth, task.id, "Adapter");

  await apiRequest(
    "DELETE",
    "/api/categories",
    { id: listId, tasks: "delete", taskIds: [task.id] },
    user1Auth.token,
  );
  expect(await findTask(user1Auth.token, "Pack")).toBeUndefined();
  expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(false);

  const later = new Date(Date.now() + 1000).toISOString();
  await apiRequest(
    "PUT",
    "/api/tasks",
    { id: task.id, deletedAt: null, updatedAt: later },
    user1Auth.token,
  );
  expect((await findTask(user1Auth.token, "Pack"))?.categoryId).toBeNull();
  expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(true);
});

test("a note needs a task", async ({ user1Auth }) => {
  const at = new Date().toISOString();
  await expect(
    apiRequest(
      "POST",
      "/api/notes",
      {
        id: `loose-${Date.now()}`,
        userId: user1Auth.userId,
        title: "Loose",
        createdAt: at,
        updatedAt: at,
      },
      user1Auth.token,
    ),
  ).rejects.toThrow(/400/);
});

test("a subtask's notes go and come back with it", async ({ user1Auth }) => {
  const at = new Date().toISOString();
  const auth = { userId: user1Auth.userId };
  const parent = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    { id: `parent-${Date.now()}`, ...auth, title: "Plan the trip", createdAt: at, updatedAt: at },
    user1Auth.token,
  );
  const subtask = await apiRequest<Task>(
    "POST",
    "/api/tasks",
    {
      id: `sub-${Date.now()}`,
      ...auth,
      parentId: parent.id,
      title: "Book the hotel",
      createdAt: at,
      updatedAt: at,
    },
    user1Auth.token,
  );
  const note = await addNote(user1Auth, subtask.id, "Late check-in");

  await apiRequest("DELETE", "/api/tasks", { id: parent.id }, user1Auth.token);
  expect(await findTask(user1Auth.token, "Book the hotel")).toBeUndefined();
  expect((await notesOf(user1Auth.token)).some((n) => n.id === note.id)).toBe(false);

  const later = new Date(Date.now() + 1000).toISOString();
  for (const id of [parent.id, subtask.id])
    await apiRequest(
      "PUT",
      "/api/tasks",
      { id, deletedAt: null, updatedAt: later },
      user1Auth.token,
    );
  expect(await findTask(user1Auth.token, "Book the hotel")).toBeTruthy();
  expect((await notesOf(user1Auth.token)).find((n) => n.id === note.id)?.taskId).toBe(subtask.id);
});

type List = { id: string; name: string; collaborators: { user: { id: string } | null }[] };
type Contact = { id: string; contactUserId: string };
const listsOf = (token: string) => apiRequest<List[]>("GET", "/api/categories", undefined, token);
const contactsOf = (token: string) =>
  apiRequest<Contact[]>("GET", "/api/contacts", undefined, token);

/** A list of user1's shared with user2, holding a task of each. */
const sharedList = async (
  user1: { token: string; userId: string },
  user2: { token: string; userId: string; username: string },
) => {
  await ensureMutualContacts(user1.token, user2.token);
  const at = new Date().toISOString();
  const id = crypto.randomUUID();
  await apiRequest(
    "POST",
    "/api/categories",
    { id, userId: user1.userId, name: `Shared ${Date.now()}`, createdAt: at, updatedAt: at },
    user1.token,
  );
  await apiRequest(
    "POST",
    `/api/categories/${id}/collaborators`,
    { username: user2.username },
    user1.token,
  );
  const task = (auth: { token: string; userId: string }, title: string) =>
    apiRequest<Task>(
      "POST",
      "/api/tasks",
      {
        id: `${title}-${Date.now()}`,
        userId: auth.userId,
        categoryId: id,
        title,
        createdAt: at,
        updatedAt: at,
      },
      auth.token,
    );
  return { id, mine: await task(user1, "Pack"), theirs: await task(user2, "Charger") };
};

for (const tasks of ["delete", "uncategorise"] as const) {
  test(`Undo of a list deleted with "${tasks}" puts back its sharing and everyone's tasks`, async ({
    user1Auth,
    user2Auth,
  }) => {
    const list = await sharedList(user1Auth, user2Auth);
    await apiRequest(
      "DELETE",
      "/api/categories",
      { id: list.id, tasks, taskIds: [list.mine.id, list.theirs.id] },
      user1Auth.token,
    );
    expect((await listsOf(user2Auth.token)).some((l) => l.id === list.id)).toBe(false);

    // Only the owner can undo it: to anyone else a deleted list doesn't exist
    await expect(
      apiRequest("POST", `/api/categories/${list.id}/restore`, undefined, user2Auth.token),
    ).rejects.toThrow(/404/);
    await apiRequest("POST", `/api/categories/${list.id}/restore`, undefined, user1Auth.token);

    const theirView = (await listsOf(user2Auth.token)).find((l) => l.id === list.id);
    expect(theirView?.collaborators.map((c) => c.user?.id)).toEqual([user2Auth.userId]);
    const inList = async (token: string, id: string) =>
      (await tasksOf(token)).find((t) => t.id === id)?.categoryId;
    expect(await inList(user1Auth.token, list.mine.id)).toBe(list.id);
    expect(await inList(user2Auth.token, list.theirs.id)).toBe(list.id);
    // A replay after a lost response changes nothing
    await apiRequest("POST", `/api/categories/${list.id}/restore`, undefined, user1Auth.token);
  });
}

test("Undo of removing a contact puts back both sides and the lists they shared", async ({
  user1Auth,
  user2Auth,
}) => {
  const list = await sharedList(user1Auth, user2Auth);
  const contact = (await contactsOf(user1Auth.token)).find(
    (c) => c.contactUserId === user2Auth.userId,
  )!;
  await apiRequest("DELETE", `/api/contacts/${contact.id}`, undefined, user1Auth.token);
  expect(
    (await contactsOf(user2Auth.token)).some((c) => c.contactUserId === user1Auth.userId),
  ).toBe(false);
  expect((await listsOf(user2Auth.token)).some((l) => l.id === list.id)).toBe(false);

  // Only the person who removed it can undo it
  await expect(
    apiRequest("POST", `/api/contacts/${contact.id}/restore`, undefined, user2Auth.token),
  ).rejects.toThrow(/404/);
  await apiRequest("POST", `/api/contacts/${contact.id}/restore`, undefined, user1Auth.token);

  expect((await contactsOf(user1Auth.token)).map((c) => c.id)).toContain(contact.id);
  expect(
    (await contactsOf(user2Auth.token)).some((c) => c.contactUserId === user1Auth.userId),
  ).toBe(true);
  expect((await listsOf(user2Auth.token)).some((l) => l.id === list.id)).toBe(true);
  await expect(
    apiRequest("POST", `/api/contacts/${contact.id}/restore`, undefined, user1Auth.token),
  ).rejects.toThrow(/404/);
});

test("Undo in the app brings back a shared list deleted with its tasks", async ({
  user1Page: page,
  user1Auth,
  user2Auth,
}) => {
  const list = await sharedList(user1Auth, user2Auth);
  const name = (await listsOf(user1Auth.token)).find((l) => l.id === list.id)!.name;
  await page.reload();
  // Open, so Undo has to bring the view back to it too
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();

  const listRow = page
    .locator("div")
    .filter({ has: page.getByRole("button", { name: new RegExp(`^${name}`) }) })
    .filter({ has: page.getByRole("button", { name: "List options" }) })
    .last();
  await listRow.hover();
  await listRow.getByRole("button", { name: "List options" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete tasks" }).click();
  await expect
    .poll(async () => (await listsOf(user2Auth.token)).some((l) => l.id === list.id))
    .toBe(false);

  await page
    .locator("[data-toast-undo]", { hasText: "List and tasks deleted" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect
    .poll(async () => (await tasksOf(user2Auth.token)).find((t) => t.id === list.theirs.id))
    .toMatchObject({ categoryId: list.id });
  await expect(page.getByRole("button", { name: new RegExp(`^${name}`) }).first()).toBeVisible();
  await expect(page.locator("[data-task-id]", { hasText: "Pack" })).toBeVisible();
});
