import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
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
vi.mock("../notify", () => ({ sendNotification: vi.fn(), getUserName: async () => "Alice" }));

const LONG_AGO = "2026-01-01T09:00:00.000Z";

beforeAll(async () => {
  for (const id of ["alice", "bob", "carol"])
    await userRepo.insert({ id, name: id, username: id, passwordHash: "x" });
  const task = (id: string, userId: string, title: string, status: "todo" | "done" = "todo") =>
    taskRepo.insert({ id, userId, title, status, createdAt: LONG_AGO, updatedAt: LONG_AGO });
  await task("milk", "alice", "Milk");
  await task("eggs", "alice", "Eggs");
  await task("bread", "alice", "Bread");
  await task("already", "alice", "Already", "done");
  await task("carols", "carol", "Carol's");
  for (const taskId of ["milk", "eggs", "bread", "already"])
    await taskShareRepo.insert({ id: `share-${taskId}`, taskId, sharedWithUserId: "bob" });
});

test("ticking several tells each person once, and refuses only the tasks it can't change", async () => {
  const res = await taskRoutes.request("/status", {
    method: "PUT",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({
      ids: ["milk", "eggs", "bread", "already", "carols"],
      status: "done",
      updatedAt: new Date().toISOString(),
    }),
  });

  expect(res.status).toBe(200);
  const { updated, refused } = (await res.json()) as {
    updated: { id: string; status: string; completedAt: string | null }[];
    refused: { id: string; status: number }[];
  };
  expect(updated.map((t) => t.id)).toEqual(["milk", "eggs", "bread", "already"]);
  expect(updated.every((t) => t.status === "done" && t.completedAt)).toBe(true);
  expect(refused).toEqual([expect.objectContaining({ id: "carols", status: 404 })]);
  expect(sendNotification).toHaveBeenCalledOnce();
  expect(sendNotification).toHaveBeenCalledWith("bob", {
    type: "task-completed",
    taskId: "milk",
    taskTitle: "Milk",
    more: 2,
    byUser: "Alice",
  });
});

describe("an edit to a shared task", () => {
  const edit = (updatedAt: string, fields: object) =>
    taskRoutes.request("/", {
      method: "PUT",
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ id: "tea", updatedAt, ...fields }),
    });

  beforeAll(async () => {
    await taskRepo.insert({
      id: "tea",
      userId: "alice",
      title: "Tea",
      description: "Green",
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
    });
    await taskShareRepo.insert({ id: "share-tea", taskId: "tea", sharedWithUserId: "bob" });
  });

  test("tells no one when it sends back what's stored", async () => {
    vi.mocked(sendNotification).mockClear();
    const res = await edit("2026-02-01T09:00:00.000Z", {
      title: "Tea",
      description: "Green",
      status: "todo",
      dueDate: null,
    });
    expect(res.status).toBe(200);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("names only what changed", async () => {
    vi.mocked(sendNotification).mockClear();
    const res = await edit("2026-03-01T09:00:00.000Z", { title: "Tea", description: "Black" });
    expect(res.status).toBe(200);
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith(
      "bob",
      expect.objectContaining({ type: "task-updated", changes: "new description" }),
    );
  });
});
