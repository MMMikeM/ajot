import { beforeAll, expect, test, vi } from "vite-plus/test";
import * as mcpTokenRepo from "../db/mcp-token.repo";
import * as userRepo from "../db/user.repo";
import { mcpTokenRoutes } from "./mcp-tokens";

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
let signedIn = "alice";
vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => signedIn,
}));

const send = (method: string, path = "/", body?: object) =>
  mcpTokenRoutes.request(path, {
    method,
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  for (const id of ["alice", "bob"])
    await userRepo.insert({ id, name: id, username: id, passwordHash: "x" });
});

test("a token is shown once, then listed only by its hint, and works until revoked", async () => {
  const res = await send("POST", "/", { name: "Laptop", canWrite: false, days: 30 });
  expect(res.status).toBe(200);
  const made = (await res.json()) as { id: string; token: string; hint: string };
  expect(made.token).toMatch(/^ajot_pat_/);
  expect(made.hint).toBe(made.token.slice(-4));

  const listed = JSON.stringify(await (await send("GET")).json());
  expect(listed).toContain(made.id);
  expect(listed).not.toContain(made.token);
  expect(listed).not.toMatch(/tokenHash/);
  expect(await mcpTokenRepo.findValid(made.token, "mcp")).toMatchObject({
    userId: "alice",
    canWrite: false,
  });

  signedIn = "bob";
  expect((await send("DELETE", `/${made.id}`)).status).toBe(404);
  signedIn = "alice";
  expect((await send("DELETE", `/${made.id}`)).status).toBe(200);
  expect(await mcpTokenRepo.findValid(made.token, "mcp")).toBeUndefined();
});

test("an expired token doesn't work", async () => {
  vi.useFakeTimers({ now: Date.now() - 31 * 24 * 60 * 60_000, toFake: ["Date"] });
  const { token } = await mcpTokenRepo.create("alice", { name: "Old", canWrite: true, days: 30 });
  vi.useRealTimers();
  expect(await mcpTokenRepo.findValid(token, "mcp")).toBeUndefined();
});

test("a person can't hold more than 20 live tokens", async () => {
  signedIn = "bob";
  for (let i = 0; i < 20; i++)
    await mcpTokenRepo.create("bob", { name: `T${i}`, canWrite: true, days: 30 });
  const res = await send("POST", "/", { name: "One more", canWrite: true, days: 30 });
  expect(res.status).toBe(400);
});
