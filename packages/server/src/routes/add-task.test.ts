import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import * as taskRepo from "../db/task.repo";
import * as userRepo from "../db/user.repo";
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

const at = "2026-11-05T09:00:00.000Z";

const add = async (id: string, fields: object = {}) => {
  const res = await taskRoutes.request("/", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({ id, userId: "", title: id, createdAt: at, updatedAt: at, ...fields }),
  });
  expect(res.status).toBe(200);
};

const storedSortOrder = async (id: string) => (await taskRepo.findListItem(id)).sortOrder;

beforeAll(async () => {
  await userRepo.insert({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
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
