import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import * as userRepo from "../db/user.repo";
import { sendNotification } from "../notify";
import { notificationRoutes } from "./notifications";
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
vi.mock("../notify", () => ({
  sendNotification: vi.fn(),
  getUserName: vi.fn(async () => "Alice"),
}));
vi.mock("../broadcast", () => ({ broadcast: vi.fn(), broadcastAll: vi.fn() }));

const PAST = "2026-01-01";
const FUTURE = "2099-01-01";

const send = async (method: "POST" | "PUT", body: object) => {
  const res = await taskRoutes.request("/", {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
};

let clock = Date.parse("2026-01-01T00:00:00.000Z");
const stamp = () => new Date((clock += 1_000)).toISOString();

const create = (id: string, dueDate?: string) => {
  const at = stamp();
  return send("POST", { id, userId: "alice", title: id, createdAt: at, updatedAt: at, dueDate });
};

const setDueDate = (id: string, dueDate: string | null) =>
  send("PUT", { id, updatedAt: stamp(), dueDate });

/** Runs the cron, and returns the reminders it sent, as their task and due date. */
const remindersSent = async () => {
  vi.mocked(sendNotification).mockClear();
  vi.stubEnv("CRON_SECRET", "cron");
  const res = await notificationRoutes.request("/process", {
    method: "POST",
    headers: { authorization: "Bearer cron" },
  });
  expect(res.status).toBe(200);
  return vi
    .mocked(sendNotification)
    .mock.calls.flatMap(([, payload]) =>
      payload.type === "reminder-due" ? [`${payload.taskId} ${payload.dueDate}`] : [],
    );
};

beforeAll(async () => {
  await userRepo.insert({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
});

describe("a task's reminder", () => {
  test("is scheduled when the task is created with a due date", async () => {
    await create("dated", PAST);
    expect(await remindersSent()).toEqual([`dated ${PAST}`]);
  });

  test("isn't again when a create is retried after it went out", async () => {
    await create("retried", PAST);
    expect(await remindersSent()).toEqual([`retried ${PAST}`]);
    await create("retried", PAST);
    expect(await remindersSent()).toEqual([]);
  });

  test("isn't, for a task created with none", async () => {
    await create("undated");
    expect(await remindersSent()).toEqual([]);
  });

  test("moves with the due date", async () => {
    await create("moved", FUTURE);
    await setDueDate("moved", PAST);
    expect(await remindersSent()).toEqual([`moved ${PAST}`]);
  });

  test("goes when the due date is cleared", async () => {
    await create("cleared", PAST);
    await setDueDate("cleared", null);
    expect(await remindersSent()).toEqual([]);
  });

  test("once sent, isn't sent again for the same date picked again", async () => {
    await create("again", PAST);
    expect(await remindersSent()).toEqual([`again ${PAST}`]);
    await setDueDate("again", PAST);
    expect(await remindersSent()).toEqual([]);
  });
});
