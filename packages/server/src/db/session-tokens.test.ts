import { randomBytes } from "node:crypto";
import { beforeAll, expect, test, vi } from "vite-plus/test";
import { db } from "./client";
import * as sessionRepo from "./session.repo";
import { sessions, users } from "./schema";

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

const storedIds = async () =>
  (await db.query.sessions.findMany({ columns: { id: true } })).map((row) => row.id);

// As sessions were stored before their tokens were hashed: the token itself is the id
const storedAsToken = async () => {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    id: token,
    userId: "alice",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  return token;
};

beforeAll(async () => {
  await db
    .insert(users)
    .values({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
});

test("a new session is stored as its token's hash, which signs no one in", async () => {
  const token = await sessionRepo.insert("alice");
  const ids = await storedIds();
  expect(ids).not.toContain(token);
  const [stored] = ids;

  expect(await sessionRepo.findValid(token)).toMatchObject({ userId: "alice" });
  expect(await sessionRepo.findValid(stored!)).toBeUndefined();
  await sessionRepo.remove(token);
});

test("a session stored as its token still signs in, and is hashed once used", async () => {
  const token = await storedAsToken();

  expect(await sessionRepo.findValid(token)).toMatchObject({ userId: "alice" });
  expect(await storedIds()).not.toContain(token);
  sessionRepo.forgetUser("alice");
  expect(await sessionRepo.findValid(token)).toMatchObject({ userId: "alice" });

  await sessionRepo.remove(token);
  expect(await storedIds()).toEqual([]);
});

test("signing out a session stored as its token ends it", async () => {
  const token = await storedAsToken();
  await sessionRepo.remove(token);
  expect(await storedIds()).toEqual([]);
  expect(await sessionRepo.findValid(token)).toBeUndefined();
});

test("the purge hashes every session still stored as its token", async () => {
  const [one, two] = [await storedAsToken(), await storedAsToken()];
  const hashed = await sessionRepo.insert("alice");

  expect(await sessionRepo.hashStoredTokens()).toBe(2);
  const ids = await storedIds();
  expect(ids).toHaveLength(3);
  expect(ids).not.toContain(one);
  expect(ids).not.toContain(two);
  for (const token of [one, two, hashed])
    expect(await sessionRepo.findValid(token)).toMatchObject({ userId: "alice" });
});

test("the purge hashes more sessions stored as their token than one statement can bind", async () => {
  await db.delete(sessions);
  const tokens = Array.from({ length: 11_000 }, () => randomBytes(32).toString("hex"));
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  for (let i = 0; i < tokens.length; i += 1_000)
    await db
      .insert(sessions)
      .values(tokens.slice(i, i + 1_000).map((id) => ({ id, userId: "alice", expiresAt })));

  expect(await sessionRepo.hashStoredTokens()).toBe(tokens.length);
  const ids = new Set(await storedIds());
  expect(ids.size).toBe(tokens.length);
  expect(tokens.filter((token) => ids.has(token))).toEqual([]);
});
