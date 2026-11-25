import { afterEach, beforeAll, expect, test, vi } from "vite-plus/test";
import { notifyMutation } from "../broadcast";
import * as sessionRepo from "../db/session.repo";
import * as userRepo from "../db/user.repo";
import { signRevocation } from "../session-revocation";
import { authRoutes } from "./auth";
import { eventsRoute } from "./events";
import { streamTicketRoutes } from "./stream-ticket";

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
vi.mock("../push-queue", () => ({ queueChanges: vi.fn() }));

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

const takeTicket = async (token: string) => {
  const res = await streamTicketRoutes.request("/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { ticket: string }).ticket;
};

const openStreams: ReadableStreamDefaultReader<Uint8Array>[] = [];
afterEach(async () => {
  for (const reader of openStreams.splice(0)) await reader.cancel();
});

const openStream = async (token: string) => {
  const res = await eventsRoute.request(`/?ticket=${await takeTicket(token)}`);
  const reader = res.body!.getReader();
  openStreams.push(reader);
  await reader.read();
  return reader;
};

// What a stream that's still open but sent nothing reads as, rather than waiting for it forever
const nextRead = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Promise.race([
    reader.read().then(({ done, value }) => (done ? "closed" : new TextDecoder().decode(value))),
    new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 200)),
  ]);

const changeTask = () =>
  notifyMutation({ model: "tasks", action: "update", data: { id: "t" } }, ["alice"]);

test("signing out closes that device's event stream, and leaves the other device's open", async () => {
  const phone = await sessionRepo.insert("alice");
  const laptop = await sessionRepo.insert("alice");
  const phoneStream = await openStream(phone);
  const laptopStream = await openStream(laptop);

  await logout(phone);
  changeTask();

  expect(await nextRead(phoneStream)).toBe("closed");
  expect(await nextRead(laptopStream)).toContain("data-changed");
});

test("a stream ticket taken before signing out opens nothing after it", async () => {
  const phone = await sessionRepo.insert("alice");
  const ticket = await takeTicket(phone);

  await logout(phone);

  expect((await eventsRoute.request(`/?ticket=${ticket}`)).status).toBe(401);
});

test("a password reset closes every stream and ticket of the account", async () => {
  vi.stubEnv("TURSO_AUTH_TOKEN", "the-database-token");
  const phone = await sessionRepo.insert("alice");
  const laptop = await sessionRepo.insert("alice");
  const phoneStream = await openStream(phone);
  const laptopStream = await openStream(laptop);
  const ticket = await takeTicket(laptop);

  const res = await authRoutes.request("/sessions-revoked", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRevocation("the-database-token", "alice")),
  });
  vi.unstubAllEnvs();

  expect(res.status).toBe(200);
  expect(await nextRead(phoneStream)).toBe("closed");
  expect(await nextRead(laptopStream)).toBe("closed");
  expect((await eventsRoute.request(`/?ticket=${ticket}`)).status).toBe(401);
});
