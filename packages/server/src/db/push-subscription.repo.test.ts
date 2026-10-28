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

const subscription = (endpoint: string, userId: string | null) => ({
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
    ["from-before-users", null],
  ] as const)
    await pushSubscriptionRepo.upsert(subscription(endpoint, userId));
});

test("unsubscribing removes the user's own subscription", async () => {
  await pushSubscriptionRepo.remove("alices", "alice");
  expect(await endpoints()).toEqual(["bobs", "from-before-users"]);
});

test("unsubscribing someone else's endpoint leaves it subscribed", async () => {
  await pushSubscriptionRepo.remove("bobs", "alice");
  expect(await endpoints()).toEqual(["alices", "bobs", "from-before-users"]);
});

test("a subscription from before they had a user, which gets everyone's pushes, can go", async () => {
  await pushSubscriptionRepo.remove("from-before-users", "alice");
  expect(await endpoints()).toEqual(["alices", "bobs"]);
});
