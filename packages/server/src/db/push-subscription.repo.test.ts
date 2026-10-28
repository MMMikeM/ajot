import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import { db } from "./client";
import pushSubscriptionRepo from "./push-subscription.repo";
import { pushSubscriptions, users } from "./schema";

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

const subscription = (endpoint: string, userId: string) => ({
  endpoint,
  userId,
  p256dh: "key",
  auth: "secret",
  kind: "web" as const,
  deviceId: null,
});
const endpoints = async () =>
  (await db.query.pushSubscriptions.findMany({ columns: { endpoint: true } }))
    .map((row) => row.endpoint)
    .sort();

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(users);
  await db
    .insert(users)
    .values(["alice", "bob"].map((id) => ({ id, name: id, username: id, passwordHash: "x" })));
  for (const [endpoint, userId] of [
    ["alices", "alice"],
    ["bobs", "bob"],
  ] as const)
    await pushSubscriptionRepo.upsert(subscription(endpoint, userId));
});

test("unsubscribing removes the user's own subscription", async () => {
  await pushSubscriptionRepo.remove("alices", "alice");
  expect(await endpoints()).toEqual(["bobs"]);
});

test("unsubscribing someone else's endpoint leaves it subscribed", async () => {
  await pushSubscriptionRepo.remove("bobs", "alice");
  expect(await endpoints()).toEqual(["alices", "bobs"]);
});

test("a user's pushes go to their subscriptions only", async () => {
  const found = await pushSubscriptionRepo.findForUsers(["alice"]);
  expect(found.map((row) => row.endpoint)).toEqual(["alices"]);
  expect(await pushSubscriptionRepo.findForUsers([])).toEqual([]);
});

test("a subscription needs a user, and goes with them", async () => {
  await expect(async () =>
    db.run(sql`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
      VALUES ('x', NULL, 'nobodys', 'key', 'secret')`),
  ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/NOT NULL/) } });
  await db.delete(users).where(eq(users.id, "bob"));
  expect(await endpoints()).toEqual(["alices"]);
});
