import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { generateKeyBetween } from "fractional-indexing";
import { db } from "./client";
import taskRepo from "./task.repo";
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
  test("goes after the last valid key, past a malformed one", async () => {
    await addTask("first", "a0");
    await addTask("last", "a1");
    // Sorts after every valid key, and fractional-indexing throws on it
    await addTask("bad", "a10");

    const key = await taskRepo.nextSortOrder("alice");

    expect(key > "a1").toBe(true);
    expect(() => generateKeyBetween(key, null)).not.toThrow();
  });
});

describe("restore", () => {
  const editAfterTheDelete = async (deletedAt: string) => {
    const at = new Date(Date.parse(deletedAt) + 1).toISOString();
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
    const undoneAt = new Date(Date.parse(deleted.updatedAt) + 60_000).toISOString();

    await taskRepo.restore("t", undoneAt);

    await expect(editAfterTheDelete(deleted.updatedAt)).rejects.toThrow(StaleUpdateError);
    const row = await db.query.tasks.findFirst({ where: { id: "t" } });
    expect(row?.title).toBe("t");
  });
});
