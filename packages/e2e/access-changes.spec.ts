import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  addCollaborator,
  addList,
  addTask,
  apiRequest,
  ensureMutualContacts,
  newId,
  now,
  send,
  shareTask,
} from "./helpers/api";
import { listenLive } from "./helpers/live";
import type { AuthResult } from "./helpers/auth";

const unique = (name: string) => `${name} ${newId().slice(0, 8)}`;
const row = (page: Page, title: string) => page.locator("[data-task-id]", { hasText: title });
const sidebarList = (page: Page, name: string) =>
  page.getByTestId("category-sidebar").getByText(name);
const collaborator = (listId: string, userId: string) =>
  `/api/categories/${listId}/collaborators/${userId}`;

/** Alice's list shared with Bob, holding a task of each of theirs. */
const sharedList = async (alice: AuthResult, bob: AuthResult) => {
  const name = unique("Ours");
  const list = await addList(alice.token, name);
  await addCollaborator(alice.token, list.id, bob.username);
  const alicesTask = await addTask(alice.token, { title: unique("Alice's"), categoryId: list.id });
  const bobsTask = await addTask(bob.token, { title: unique("Bob's"), categoryId: list.id });
  return { list, name, alicesTask, bobsTask };
};

test.describe("a change to who reaches a task reaches an open page live", () => {
  test("sharing a task sends it with its subtasks, and its owner sees who has it", async ({
    user1Auth: alice,
    user2Auth: bob,
    user1Page: alicePage,
    user2Page: bobPage,
  }) => {
    const task = await addTask(alice.token, { title: unique("Shared") });
    const subtask = await addTask(alice.token, { title: unique("Its subtask"), parentId: task.id });
    const bobLive = listenLive(bobPage);
    const aliceLive = listenLive(alicePage);
    await Promise.all([bobLive.open(), aliceLive.open()]);

    await shareTask(alice.token, task.id, bob.username);

    await expect(row(bobPage, task.title)).toBeVisible();
    await bobLive.expectHeard("tasks.insert", task.id);
    await bobLive.expectHeard("tasks.insert", subtask.id);
    await expect(row(alicePage, task.title).getByTitle(`Shared with ${bob.name}`)).toBeVisible();
    bobLive.assertAllApplied();
    aliceLive.assertAllApplied();
  });

  test("unsharing takes the task off the page of the person who lost it", async ({
    user1Auth: alice,
    user2Auth: bob,
    user2Page: page,
  }) => {
    const task = await addTask(alice.token, { title: unique("Unshared") });
    const share = await shareTask(alice.token, task.id, bob.username);
    const live = listenLive(page);
    await live.open();
    await expect(row(page, task.title)).toBeVisible();

    await apiRequest("DELETE", "/api/tasks/share", { id: share.id }, alice.token);

    await expect(row(page, task.title)).toHaveCount(0);
    await live.expectHeard("tasks.delete", task.id);
    live.assertAllApplied();
  });

  test("adding a collaborator sends them the list and its tasks", async ({
    user1Auth: alice,
    user2Auth: bob,
    user2Page: page,
  }) => {
    const name = unique("Joined");
    const list = await addList(alice.token, name);
    const task = await addTask(alice.token, { title: unique("In it"), categoryId: list.id });
    const live = listenLive(page);
    await live.open();

    await addCollaborator(alice.token, list.id, bob.username);

    await live.expectHeard("categories.insert", list.id);
    await live.expectHeard("tasks.insert", task.id);
    await sidebarList(page, name).click();
    await expect(row(page, task.title)).toBeVisible();
    live.assertAllApplied();
  });

  test("removing a collaborator takes their tasks to their Inbox and the list's away", async ({
    user1Auth: alice,
    user2Auth: bob,
    user1Page: alicePage,
    user2Page: bobPage,
  }) => {
    const { list, name, alicesTask, bobsTask } = await sharedList(alice, bob);
    const aliceLive = listenLive(alicePage);
    const bobLive = listenLive(bobPage);
    await Promise.all([aliceLive.open(`/list/${list.id}`), bobLive.open()]);
    await expect(row(alicePage, bobsTask.title)).toBeVisible();

    await apiRequest("DELETE", collaborator(list.id, bob.userId), undefined, alice.token);

    await expect(row(bobPage, bobsTask.title)).toBeVisible();
    await expect(sidebarList(bobPage, name)).toHaveCount(0);
    await bobLive.expectHeard("tasks.delete", alicesTask.id);
    await expect(row(alicePage, bobsTask.title)).toHaveCount(0);
    await expect(row(alicePage, alicesTask.title)).toBeVisible();
    aliceLive.assertAllApplied();
    bobLive.assertAllApplied();
  });

  test("removing a contact and undoing it takes the shared list away and puts it all back", async ({
    user1Auth: alice,
    user2Auth: bob,
    user1Page: alicePage,
    user2Page: bobPage,
  }) => {
    const { list, name, alicesTask, bobsTask } = await sharedList(alice, bob);
    const filed = await addTask(alice.token, { title: unique("Filed by Bob") });
    await shareTask(alice.token, filed.id, bob.username);
    const filing = { taskId: filed.id, categoryId: list.id };
    await apiRequest("PUT", "/api/tasks/share", filing, bob.token);
    const contacts = await apiRequest<{ id: string; contactUserId: string }[]>(
      "GET",
      "/api/contacts",
      undefined,
      alice.token,
    );
    const contact = contacts.find((c) => c.contactUserId === bob.userId)!;
    const aliceLive = listenLive(alicePage);
    const bobLive = listenLive(bobPage);
    await Promise.all([aliceLive.open(`/list/${list.id}`), bobLive.open()]);

    let restored = false;
    try {
      await apiRequest("DELETE", `/api/contacts/${contact.id}`, undefined, alice.token);
      await expect(row(bobPage, bobsTask.title)).toBeVisible();
      await expect(row(bobPage, filed.title)).toBeVisible();
      await expect(sidebarList(bobPage, name)).toHaveCount(0);
      await bobLive.expectHeard("tasks.delete", alicesTask.id);
      await expect(row(alicePage, bobsTask.title)).toHaveCount(0);

      await apiRequest("POST", `/api/contacts/${contact.id}/restore`, undefined, alice.token);
      restored = true;
      await expect(sidebarList(bobPage, name)).toBeVisible();
      await bobLive.expectHeard("tasks.insert", alicesTask.id);
      // Back in the list, so out of Bob's Inbox
      await expect(row(bobPage, bobsTask.title)).toHaveCount(0);
      await expect(row(bobPage, filed.title)).toHaveCount(0);
      await expect(row(alicePage, bobsTask.title)).toBeVisible();
      aliceLive.assertAllApplied();
      bobLive.assertAllApplied();
    } finally {
      // The next test in this worker needs them to be contacts
      if (!restored) {
        await send(`/api/contacts/${contact.id}/restore`, { method: "POST", token: alice.token });
        await ensureMutualContacts(alice.token, bob.token);
      }
    }
  });

  test("deleting a list takes its owner's tasks off a collaborator's page", async ({
    user1Auth: alice,
    user2Auth: bob,
    user2Page: page,
  }) => {
    const { list, alicesTask, bobsTask } = await sharedList(alice, bob);
    const live = listenLive(page);
    await live.open();

    await apiRequest(
      "DELETE",
      "/api/categories",
      { id: list.id, tasks: "uncategorise", taskIds: [alicesTask.id, bobsTask.id] },
      alice.token,
    );

    await live.expectHeard("categories.delete", list.id);
    await live.expectHeard("tasks.delete", alicesTask.id);
    await expect(row(page, bobsTask.title)).toBeVisible();
    live.assertAllApplied();
  });
});

test.describe("what a list's members and strangers may do to it", () => {
  const status = async (method: string, path: string, body: unknown, token: string) =>
    (await send(path, { method, body, token })).status;

  const attempts = (listId: string, owner: AuthResult) =>
    [
      ["PUT", "/api/categories", { id: listId, name: "Renamed", updatedAt: now() }],
      ["DELETE", "/api/categories", { id: listId }],
      ["GET", `/api/categories/${listId}/collaborators`, undefined],
      ["POST", `/api/categories/${listId}/collaborators`, { username: owner.username }],
      ["DELETE", collaborator(listId, owner.userId), undefined],
    ] as const;

  test("someone not in it finds no such list", async ({ user1Auth: alice, user2Auth: bob }) => {
    const list = await addList(alice.token, unique("Private"));
    for (const [method, path, body] of attempts(list.id, alice))
      expect(await status(method, path, body, bob.token), `${method} ${path}`).toBe(404);

    await apiRequest("DELETE", "/api/categories", { id: list.id }, alice.token);
    expect(await status("POST", `/api/categories/${list.id}/restore`, undefined, bob.token)).toBe(
      404,
    );
  });

  test("a collaborator can't change it, only leave it", async ({
    user1Auth: alice,
    user2Auth: bob,
  }) => {
    const list = await addList(alice.token, unique("Shared"));
    await addCollaborator(alice.token, list.id, bob.username);
    for (const [method, path, body] of attempts(list.id, alice))
      expect(await status(method, path, body, bob.token), `${method} ${path}`).toBe(403);
    const leaving = await status("DELETE", collaborator(list.id, bob.userId), undefined, bob.token);
    expect(leaving).toBe(200);
  });

  test("once deleted, it's gone for its collaborators", async ({
    user1Auth: alice,
    user2Auth: bob,
  }) => {
    const list = await addList(alice.token, unique("Deleted"));
    await addCollaborator(alice.token, list.id, bob.username);
    await apiRequest("DELETE", "/api/categories", { id: list.id }, alice.token);
    expect(await status("POST", `/api/categories/${list.id}/restore`, undefined, bob.token)).toBe(
      404,
    );
    expect(await status("POST", `/api/categories/${list.id}/restore`, undefined, alice.token)).toBe(
      200,
    );
  });

  test("only a task's owner shares it or takes a share back", async ({
    user1Auth: alice,
    user2Auth: bob,
  }) => {
    const theirs = await addTask(alice.token);
    const shareIt = (taskId: string) =>
      status("POST", "/api/tasks/share", { taskId, username: alice.username }, bob.token);
    expect(await shareIt(theirs.id)).toBe(404);

    const share = await shareTask(alice.token, theirs.id, bob.username);
    expect(await shareIt(theirs.id)).toBe(403);
    expect(await status("DELETE", "/api/tasks/share", { id: share.id }, bob.token)).toBe(403);
  });
});
