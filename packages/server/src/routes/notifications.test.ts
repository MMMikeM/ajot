import { beforeAll, beforeEach, expect, test, vi } from "vite-plus/test";
import notificationQueueRepo from "../db/notification-queue.repo";
import taskRepo from "../db/task.repo";
import userRepo from "../db/user.repo";
import { sendNotification } from "../notify";
import type { NotificationPayload } from "../push-plan";
import { notificationRoutes } from "./notifications";

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
vi.mock("../notify", () => ({ sendNotification: vi.fn() }));

const runCron = async () => {
  const res = await notificationRoutes.request("/process", {
    method: "POST",
    headers: { authorization: "Bearer cron" },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { reminders: number; digests: number };
};

// Every send tried, in order, a failed one included
const sendsOf = (type: NotificationPayload["type"]) =>
  vi
    .mocked(sendNotification)
    .mock.calls.filter(([, payload]) => payload.type === type)
    .map(([userId]) => userId);
const sentOf = (type: NotificationPayload["type"]) => sendsOf(type).sort();

const failFirstSendOf = (type: NotificationPayload["type"]) => {
  let failed = false;
  vi.mocked(sendNotification).mockImplementation((_userId, payload) => {
    if (payload.type !== type || failed) return;
    failed = true;
    throw new Error("send failed");
  });
};

beforeAll(() => vi.stubEnv("CRON_SECRET", "cron"));

// Each test's own people, each with a task overdue: the day's digests sent stay sent
let people: string[] = [];
let tasksOf: string[] = [];
let testNumber = 0;
beforeEach(async () => {
  vi.mocked(sendNotification).mockReset();
  const prefix = `test${++testNumber}`;
  people = [`${prefix}-alice`, `${prefix}-bob`].sort();
  tasksOf = people.map((id) => `${id}-task`);
  for (const id of people) {
    await userRepo.insert({ id, name: id, username: id, passwordHash: "x" });
    await taskRepo.insert({
      id: `${id}-task`,
      userId: id,
      title: "Overdue",
      dueDate: "2026-01-01",
    });
  }
});

test("two runs at once send each user one digest, and a later run that day none", async () => {
  const counts = await Promise.all([runCron(), runCron()]);
  expect(sentOf("overdue-digest")).toEqual(people);
  expect(counts.reduce((sum, count) => sum + count.digests, 0)).toBe(2);

  expect(await runCron()).toMatchObject({ digests: 0 });
  expect(sentOf("overdue-digest")).toEqual(people);
});

test("a digest whose send fails goes out on the next run, and isn't counted sent", async () => {
  failFirstSendOf("overdue-digest");
  expect(await runCron()).toMatchObject({ digests: 1 });
  const [failed] = sendsOf("overdue-digest");

  expect(await runCron()).toMatchObject({ digests: 1 });
  expect(sendsOf("overdue-digest").slice(2)).toEqual([failed]);
  expect(await runCron()).toMatchObject({ digests: 0 });
});

test("two runs at once send each due reminder once, and a later run none", async () => {
  for (const id of tasksOf) await notificationQueueRepo.scheduleReminder(id);
  const counts = await Promise.all([runCron(), runCron()]);
  expect(sentOf("reminder-due")).toEqual(people);
  expect(counts.reduce((sum, count) => sum + count.reminders, 0)).toBe(2);

  expect(await runCron()).toMatchObject({ reminders: 0 });
  expect(sentOf("reminder-due")).toEqual(people);
});

test("a reminder whose send fails goes out on the next run", async () => {
  await notificationQueueRepo.scheduleReminder(tasksOf[0]!);
  failFirstSendOf("reminder-due");
  expect(await runCron()).toMatchObject({ reminders: 0 });

  expect(await runCron()).toMatchObject({ reminders: 1 });
  expect(await runCron()).toMatchObject({ reminders: 0 });
  expect(sendsOf("reminder-due")).toEqual([people[0], people[0]]);
});
