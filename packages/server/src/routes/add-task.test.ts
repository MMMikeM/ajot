import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as taskRepo from "../db/task.repo";
import { requireTask } from "./task-users";
import { taskRoutes } from "./tasks";

vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("../db/task.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  insert: vi.fn(async (data: object) => data),
  nextSortOrder: vi.fn(async () => "a9"),
}));
vi.mock("./task-users", () => ({
  requireTask: vi.fn(),
  audienceOf: vi.fn(async () => ["alice"]),
  markTaskEdited: vi.fn(),
}));
vi.mock("../broadcast", () => ({ broadcast: vi.fn(), broadcastAll: vi.fn() }));

const at = "2026-11-05T09:00:00.000Z";

const add = (fields: object) =>
  taskRoutes.request("/", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({ id: "t1", userId: "", title: "Read later", createdAt: at, updatedAt: at, ...fields }),
  });

const insertedSortOrder = () => vi.mocked(taskRepo.insert).mock.calls[0]![0].sortOrder;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireTask).mockResolvedValue({
    task: { id: "p1", parentId: null },
    access: [],
  } as never);
});

describe("adding a task", () => {
  test("with no sort key goes after the user's tasks", async () => {
    expect((await add({})).status).toBe(200);
    expect(taskRepo.nextSortOrder).toHaveBeenCalledWith("alice");
    expect(insertedSortOrder()).toBe("a9");
  });

  test("keeps a sort key the client chose, null included", async () => {
    await add({ sortOrder: "a3" });
    expect(insertedSortOrder()).toBe("a3");
    vi.clearAllMocks();
    await add({ sortOrder: null });
    expect(insertedSortOrder()).toBeNull();
    expect(taskRepo.nextSortOrder).not.toHaveBeenCalled();
  });

  test("leaves a subtask's sort key alone", async () => {
    await add({ parentId: "p1" });
    expect(taskRepo.nextSortOrder).not.toHaveBeenCalled();
    expect(insertedSortOrder()).toBeUndefined();
  });
});
