import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { now } from "@newtab-todo/shared/iso";
import { db } from "./client";
import categoryRepo from "./category.repo";
import noteRepo from "./note.repo";
import taskRepo from "./task.repo";
import { categories, notes, tasks, users } from "./schema";

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

const FAR_FUTURE = "9999-12-31T23:59:59.999Z";
const PAST = "2026-01-01T09:00:00.000Z";
// A device whose clock is right, editing a moment after the one whose clock is far ahead
const later = () => new Date(Date.now() + 5).toISOString();
const wait = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(async () => {
  await db.delete(notes);
  await db.delete(tasks);
  await db.delete(categories);
  await db.delete(users);
  await db
    .insert(users)
    .values({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
});

describe("a task stamped far in the future", () => {
  test("by an edit, is stored at the server's time, so the next edit still wins", async () => {
    await taskRepo.insert({ id: "t", userId: "alice", title: "t", updatedAt: PAST });

    const ahead = await taskRepo.update("t", FAR_FUTURE, { title: "From the fast clock" });
    expect(ahead.updatedAt <= now()).toBe(true);
    await wait();

    const next = await taskRepo.update("t", later(), { title: "From the right clock" });
    expect(next.title).toBe("From the right clock");
  });

  test("when added, is stored at the server's time", async () => {
    const added = await taskRepo.insert({
      id: "t",
      userId: "alice",
      title: "t",
      updatedAt: FAR_FUTURE,
      editedAt: FAR_FUTURE,
      completedAt: FAR_FUTURE,
    });
    expect(added.updatedAt <= now()).toBe(true);
    expect(added.editedAt! <= now()).toBe(true);
    expect(added.completedAt! <= now()).toBe(true);
    await wait();

    expect((await taskRepo.update("t", later(), { title: "Edited" })).title).toBe("Edited");
    expect(await taskRepo.markEdited("t", later())).toBeDefined();
  });

  test("when sent to someone, is stored at the server's time", async () => {
    const sent = await taskRepo.insertSent({
      id: "t",
      userId: "alice",
      title: "t",
      updatedAt: FAR_FUTURE,
    });
    expect(sent.updatedAt <= now()).toBe(true);
  });

  test("by a restore, is stored at the server's time", async () => {
    await taskRepo.insert({ id: "t", userId: "alice", title: "t", updatedAt: PAST });
    await taskRepo.remove("t");

    const restored = await taskRepo.restore("t", FAR_FUTURE);
    expect(restored.updatedAt <= now()).toBe(true);
  });

  test("by its subtask's edit, is marked edited at the server's time", async () => {
    await taskRepo.insert({ id: "t", userId: "alice", title: "t", updatedAt: PAST });

    expect((await taskRepo.markEdited("t", FAR_FUTURE))!.editedAt! <= now()).toBe(true);
    await wait();
    expect(await taskRepo.markEdited("t", later())).toBeDefined();
  });
});

test("a stamp from the past is kept as the device sent it", async () => {
  await taskRepo.insert({ id: "t", userId: "alice", title: "t", updatedAt: PAST });
  expect((await taskRepo.update("t", "2026-01-02T00:00:00.000Z", { title: "x" })).updatedAt).toBe(
    "2026-01-02T00:00:00.000Z",
  );
});

test("a note stamped far in the future can still be edited", async () => {
  await taskRepo.insert({ id: "t", userId: "alice", title: "t", updatedAt: PAST });
  const added = await noteRepo.insert({
    id: "n",
    userId: "alice",
    taskId: "t",
    title: "n",
    updatedAt: FAR_FUTURE,
  });
  expect(added.updatedAt <= now()).toBe(true);
  await wait();
  await noteRepo.update("n", "alice", FAR_FUTURE, { title: "Ahead" });
  await wait();

  expect((await noteRepo.update("n", "alice", later(), { title: "Right" })).title).toBe("Right");
});

test("a list stamped far in the future can still be edited", async () => {
  const added = await categoryRepo.insert({
    id: "l",
    userId: "alice",
    name: "l",
    updatedAt: FAR_FUTURE,
  });
  expect(added.updatedAt <= now()).toBe(true);
  await wait();
  await categoryRepo.update("l", FAR_FUTURE, { name: "Ahead" });
  await wait();

  expect((await categoryRepo.update("l", later(), { name: "Right" })).name).toBe("Right");
});
