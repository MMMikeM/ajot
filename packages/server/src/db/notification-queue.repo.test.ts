import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "./client";
import * as notificationQueueRepo from "./notification-queue.repo";
import { notificationQueue, tasks, users } from "./schema";

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

const rows = () =>
  db.query.notificationQueue.findMany({
    columns: { id: true, userId: true, type: true, taskId: true, scheduledFor: true, sentAt: true },
    orderBy: { scheduledFor: "asc" },
  });

const setDueDate = (dueDate: string | null) =>
  db.update(tasks).set({ dueDate }).where(eq(tasks.id, "t1"));

beforeEach(async () => {
  await db.delete(notificationQueue);
  await db.delete(tasks);
  await db.delete(users);
  await db
    .insert(users)
    .values(["alice", "bob"].map((id) => ({ id, name: id, username: id, passwordHash: "x" })));
  await db.insert(tasks).values({ id: "t1", userId: "alice", title: "Pay rent" });
});

describe("scheduling a task's reminder", () => {
  const schedule = async (dueDate: string | null) => {
    await setDueDate(dueDate);
    await notificationQueueRepo.scheduleReminder("t1");
  };

  test("adds none for a task with no due date", async () => {
    await schedule(null);
    expect(await rows()).toEqual([]);
  });

  test("keeps one already sent, and adds the next beside it", async () => {
    await schedule("2026-11-01");
    const [sent] = await notificationQueueRepo.claimDueReminders("2026-11-01T09:00:00.000Z");
    await schedule("2026-11-08");
    expect(await rows()).toMatchObject([
      { id: sent!.id, scheduledFor: "2026-11-01", sentAt: "2026-11-01T09:00:00.000Z" },
      { scheduledFor: "2026-11-08", sentAt: null },
    ]);
  });
});

describe("cancelling a task's reminder", () => {
  test("drops the unsent one once the task has no due date", async () => {
    await setDueDate("2026-11-01");
    await notificationQueueRepo.scheduleReminder("t1");
    await setDueDate(null);
    await notificationQueueRepo.cancelReminder("t1");
    expect(await rows()).toEqual([]);
  });

  test("keeps it if the task has been given a due date since", async () => {
    await setDueDate("2026-11-01");
    await notificationQueueRepo.scheduleReminder("t1");
    await notificationQueueRepo.cancelReminder("t1");
    expect(await rows()).toMatchObject([{ scheduledFor: "2026-11-01", sentAt: null }]);
  });
});

describe("claiming the reminders due", () => {
  const at = "2026-11-01T09:00:00.000Z";

  beforeEach(async () => {
    await setDueDate("2026-11-01");
    await notificationQueueRepo.scheduleReminder("t1");
  });

  test("released after the task got a new reminder, stays marked", async () => {
    const [claimed] = await notificationQueueRepo.claimDueReminders(at);
    await setDueDate("2026-11-08");
    await notificationQueueRepo.scheduleReminder("t1");
    await notificationQueueRepo.releaseReminders([claimed!.id], at);
    expect(await rows()).toMatchObject([
      { id: claimed!.id, sentAt: at },
      { scheduledFor: "2026-11-08", sentAt: null },
    ]);
  });
});

describe("claiming the day's digests", () => {
  const morning = "2026-10-28T08:00:00.000Z";
  const userIdsOf = (claims: { userId: string }[]) => claims.map((claim) => claim.userId).sort();

  test("passes over a user who's gone, and claims the rest", async () => {
    const claimed = await notificationQueueRepo.claimDigests(
      ["alice", "deleted", "bob"],
      "2026-10-28",
      morning,
    );
    expect(userIdsOf(claimed)).toEqual(["alice", "bob"]);
  });

  test("claims everyone across several statements", async () => {
    const many = Array.from(
      { length: notificationQueueRepo.DIGEST_CLAIM_CHUNK * 2 + 1 },
      (_, i) => `user-${i}`,
    );
    await db
      .insert(users)
      .values(many.map((id) => ({ id, name: id, username: id, passwordHash: "x" })));
    const claimed = await notificationQueueRepo.claimDigests(many, "2026-10-28", morning);
    expect(userIdsOf(claimed)).toEqual([...many].sort());
  });
});
