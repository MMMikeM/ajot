import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "./client";
import * as taskRepo from "./task.repo";
import { StaleUpdateError } from "./errors";
import { tasks, users } from "./schema";

// vi.mock runs before this file's imports, so the database it builds can only be imported there
vi.mock("./client", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { migrate } = await import("./migrator");
  const { relations } = await import("./schema");
  const memory = drizzle({ client: new DatabaseSync(":memory:"), relations });
  await migrate(memory, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  return { db: memory, inTransaction: (run: (tx: typeof memory) => unknown) => run(memory) };
});

// Before the delete, which the server stamps with the real time
const BEFORE_THE_DELETE = "2026-01-01T09:00:00.000Z";

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(users);
  await db
    .insert(users)
    .values({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
});

const addTask = (id: string, sortOrder: string | null) =>
  db
    .insert(tasks)
    .values({ id, userId: "alice", title: id, sortOrder, updatedAt: BEFORE_THE_DELETE });

describe("nextSortOrder", () => {
  test("goes after the user's last top-level task", async () => {
    await addTask("first", "a0");
    await addTask("last", "a1");

    const key = await taskRepo.nextSortOrder("alice");

    expect(key > "a1").toBe(true);
    expect(() => generateKeyBetween(key, null)).not.toThrow();
  });
});

describe("a malformed sortOrder a client sends", () => {
  test("is left out of an update, which still goes through", async () => {
    await addTask("t", "a0");

    const row = await taskRepo.update("t", "2026-01-01T10:00:00.000Z", {
      title: "Renamed",
      sortOrder: "a10",
    });

    expect(row).toMatchObject({ title: "Renamed", sortOrder: "a0" });
  });

  test("is left out of an insert, which sorts first", async () => {
    const row = await taskRepo.insert({ id: "t", userId: "alice", title: "t", sortOrder: "a10" });

    expect(row.sortOrder).toBeNull();
  });

  test("is refused by the database", async () => {
    await expect(addTask("t", "a10")).rejects.toHaveProperty(
      "cause.message",
      expect.stringMatching(/CHECK constraint failed: sort_order_is_a_key/),
    );
  });
});

describe("restore", () => {
  const editAfterTheDelete = async (deletedAt: string) => {
    const at = new Date(Date.parse(deletedAt) + 1).toISOString();
    // The server stores no stamp ahead of its own clock, so the edit has to come after it too
    while (new Date().toISOString() <= at) await new Promise((resolve) => setTimeout(resolve, 1));
    return taskRepo.update("t", at, { title: "Edited after the delete" });
  };

  test("with the task's own stamp, an edit made after the delete still wins", async () => {
    await addTask("t", "a0");
    const { task: deleted } = await taskRepo.remove("t");

    const restored = await taskRepo.restore("t", BEFORE_THE_DELETE);

    expect(restored.deletedAt).toBeNull();
    expect(restored.updatedAt).toBe(deleted.updatedAt);
    await expect(editAfterTheDelete(deleted.updatedAt)).resolves.toMatchObject({
      title: "Edited after the delete",
    });
  });

  test("restamped at the Undo, it turns that edit away", async () => {
    await addTask("t", "a0");
    const { task: deleted } = await taskRepo.remove("t");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const undoneAt = new Date().toISOString();

    await taskRepo.restore("t", undoneAt);

    await expect(editAfterTheDelete(deleted.updatedAt)).rejects.toThrow(StaleUpdateError);
    const row = await db.query.tasks.findFirst({ where: { id: "t" } });
    expect(row?.title).toBe("t");
  });
});

// Drizzle wraps the driver's error, as app.ts's onError says
const refusedByAForeignKey = ["cause.message", expect.stringMatching(/FOREIGN KEY/)] as const;

describe("a subtask's restore", () => {
  const addSubtask = (id: string, parentId: string) =>
    db.insert(tasks).values({ id, userId: "alice", parentId, title: id });

  beforeEach(async () => {
    await addTask("parent", "a0");
    await addSubtask("sub", "parent");
  });

  test("is refused while its parent is deleted, where it would be shown nowhere", async () => {
    await taskRepo.remove("parent");

    await expect(taskRepo.restore("sub", BEFORE_THE_DELETE)).rejects.toHaveProperty(
      ...refusedByAForeignKey,
    );
    await expect(
      taskRepo.insert({ id: "sub", userId: "alice", parentId: "parent", title: "Re-added" }),
    ).rejects.toHaveProperty(...refusedByAForeignKey);
    const sub = await db.query.tasks.findFirst({ where: { id: "sub" } });
    expect(sub?.deletedAt).not.toBeNull();
  });

  test("goes through once Undo has restored the parent first", async () => {
    await taskRepo.remove("parent");

    await taskRepo.restore("parent", BEFORE_THE_DELETE);
    const sub = await taskRepo.restore("sub", BEFORE_THE_DELETE);

    expect(sub.deletedAt).toBeNull();
  });

  test("leaves no way to hide a parent from under a live subtask", async () => {
    await expect(
      db.update(tasks).set({ deletedAt: BEFORE_THE_DELETE }).where(eq(tasks.id, "parent")),
    ).rejects.toHaveProperty(...refusedByAForeignKey);
  });
});

describe("sharing again with the same person", () => {
  beforeEach(async () => {
    await db.insert(users).values({ id: "bob", name: "Bob", username: "bob", passwordHash: "x" });
    await addTask("t", "a0");
  });
  const shareWithBob = (id: string, permission: "view" | "edit") =>
    taskRepo.insertShare({ id, taskId: "t", sharedWithUserId: "bob", permission });

  test("with another permission changes it on the one share", async () => {
    await shareWithBob("first", "view");
    const again = await shareWithBob("second", "edit");
    expect(again).toMatchObject({
      added: false,
      changed: true,
      share: { id: "first", permission: "edit" },
    });
  });

  test("with the same permission changes nothing", async () => {
    await shareWithBob("first", "edit");
    const again = await shareWithBob("second", "edit");
    expect(again).toMatchObject({ added: false, changed: false, share: { id: "first" } });
  });
});
