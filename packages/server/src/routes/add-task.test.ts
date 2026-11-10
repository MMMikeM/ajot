import { beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import * as inviteTokenRepo from "../db/invite-token.repo";
import * as taskRepo from "../db/task.repo";
import * as taskShareRepo from "../db/task-share.repo";
import * as userRepo from "../db/user.repo";
import { sendNotification } from "../notify";
import { taskRoutes } from "./tasks";

// vi.mock runs before this file's imports, so the database it builds can only be imported there
vi.mock("../db/client", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { migrate } = await import("../db/migrator");
  const { relations } = await import("../db/schema");
  const memory = drizzle({ client: new DatabaseSync(":memory:"), relations });
  await migrate(memory, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  return { db: memory, inTransaction: (run: (tx: typeof memory) => unknown) => run(memory) };
});
vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../broadcast", () => ({ broadcast: vi.fn(), broadcastAll: vi.fn() }));
vi.mock("../notify", () => ({
  sendNotification: vi.fn(),
  getUserName: vi.fn(async () => "Alice"),
}));

const at = "2026-11-05T09:00:00.000Z";

const send = (id: string, fields: object = {}) =>
  taskRoutes.request("/", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({ id, userId: "", title: id, createdAt: at, updatedAt: at, ...fields }),
  });

const add = async (id: string, fields: object = {}) => {
  const res = await send(id, fields);
  expect(res.status).toBe(200);
  return (await res.json()) as { shares: { id: string; sharedWithUserId: string }[] };
};

const storedSortOrder = async (id: string) => (await taskRepo.findListItem(id)).sortOrder;

beforeAll(async () => {
  for (const name of ["Alice", "Bob", "Carol"]) {
    const id = name.toLowerCase();
    await userRepo.insert({ id, name, username: id, passwordHash: "x" });
  }
  await inviteTokenRepo.consume(await inviteTokenRepo.create("alice", hoursFromNow(1)), "bob");
  await add("last", { sortOrder: "a5" });
});

describe("adding a top-level task", () => {
  test("sent with no sort key, it goes after the user's tasks", async () => {
    await add("read-later");
    expect((await storedSortOrder("read-later"))! > "a5").toBe(true);
  });

  test("keeps a sort key the client chose, null included", async () => {
    await add("chosen", { sortOrder: "a3" });
    expect(await storedSortOrder("chosen")).toBe("a3");
    await add("unsorted", { sortOrder: null });
    expect(await storedSortOrder("unsorted")).toBeNull();
  });
});

describe("sharing a task as it's added", () => {
  const withBob = { id: "share-bob", sharedWithUserId: "bob", permission: "edit" };
  beforeEach(() => vi.mocked(sendNotification).mockClear());

  test("shares it with each contact named, and tells them", async () => {
    const added = await add("for-bob", { shares: [withBob] });

    expect(added.shares).toMatchObject([{ id: "share-bob", sharedWithUserId: "bob" }]);
    expect(sendNotification).toHaveBeenCalledExactlyOnceWith("bob", {
      type: "task-shared",
      taskId: "for-bob",
      taskTitle: "for-bob",
      fromUser: "Alice",
    });
  });

  // A contact removed while the add waited offline: refusing would lose the task
  test("adds it without sharing with someone who isn't a contact", async () => {
    const added = await add("not-for-carol", {
      shares: [{ id: "share-carol", sharedWithUserId: "carol", permission: "edit" }],
    });

    expect(added.shares).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("sent again, tells no one twice and keeps a share changed since", async () => {
    await add("retried", { shares: [{ ...withBob, id: "share-retried" }] });
    await taskShareRepo.insert({
      id: "share-retried",
      taskId: "retried",
      sharedWithUserId: "bob",
      permission: "view",
    });
    vi.mocked(sendNotification).mockClear();

    const added = await add("retried", { shares: [{ ...withBob, id: "share-retried" }] });

    expect(added.shares).toMatchObject([{ id: "share-retried", permission: "view" }]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("refuses it on a subtask, which goes wherever its parent is", async () => {
    const res = await send("shared-subtask", { parentId: "for-bob", shares: [withBob] });
    expect(res.status).toBe(400);
  });
});
