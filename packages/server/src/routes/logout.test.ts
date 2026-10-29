import { beforeAll, expect, test, vi } from "vite-plus/test";
import * as sessionRepo from "../db/session.repo";
import * as userRepo from "../db/user.repo";
import { authRoutes } from "./auth";

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

beforeAll(async () => {
  await userRepo.insert({ id: "alice", name: "Alice", username: "alice", passwordHash: "x" });
});

const logout = (token: string) =>
  authRoutes.request("/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });

test("signing out on one device leaves the account signed in on the others", async () => {
  const phone = await sessionRepo.insert("alice");
  const laptop = await sessionRepo.insert("alice");
  // Both looked up, so both are cached, as they are once a device has made a request
  expect(await sessionRepo.findValid(phone)).toBeDefined();
  expect(await sessionRepo.findValid(laptop)).toBeDefined();

  const res = await logout(phone);

  expect(res.status).toBe(200);
  expect(await sessionRepo.findValid(phone)).toBeUndefined();
  expect(await sessionRepo.findValid(laptop)).toMatchObject({ userId: "alice" });
});

test("a sign-out sent again, after the session is gone, still succeeds", async () => {
  const phone = await sessionRepo.insert("alice");
  await logout(phone);

  expect((await logout(phone)).status).toBe(200);
});
