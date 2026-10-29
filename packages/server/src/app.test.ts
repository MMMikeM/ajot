import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { beforeEach, expect, test, vi } from "vite-plus/test";
import app, { MAX_BODY_BYTES } from "./app";
import { MAX_ID, MAX_TASK_IDS, MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { CSP_HEADER, contentSecurityPolicy } from "@newtab-todo/shared/csp";
import { signup } from "./auth-service";

vi.mock("./db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("./auth-service", () => ({ login: vi.fn(), signup: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

// routes/auth.test.ts mounts the hook itself; this is the app the server runs
const signUp = (body: object) =>
  app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("the page and the API carry the Content Security Policy", async () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html>");
  app.get("*", serveStatic({ root: dist, path: "index.html" }));

  for (const path of ["/", "/task/abc", "/api/config"]) {
    const res = await app.request(path);
    expect(res.headers.get(CSP_HEADER), path).toBe(contentSecurityPolicy());
  }
  expect(await (await app.request("/task/abc")).text()).toBe("<!doctype html>");
});

test("input a route refuses is answered with a message the client can show", async () => {
  const res = await signUp({ username: "ab", password: "long enough", name: "Al" });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Username must be at least 3 characters" });
  expect(signup).not.toHaveBeenCalled();
});

test.each([
  ["FOREIGN KEY constraint failed", "Part of this no longer exists, so it wasn't saved."],
  ["CHECK constraint failed: sort_order_is_a_key", "That change isn't one the app can save."],
])("a write the database refuses (%s) isn't retried", async (message, error) => {
  // As libSQL's driver throws it, wrapped by drizzle
  const refusal = Object.assign(new Error(`SQLite error: ${message}`), {
    code: "SQLITE_CONSTRAINT",
  });
  vi.mocked(signup).mockRejectedValueOnce(new Error("Failed query", { cause: refusal }));

  const res = await signUp({ username: "alice", password: "long enough", name: "Alice" });

  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error });
});

test("a body over the limit is refused in words, with CORS headers an extension can read", async () => {
  const res = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "chrome-extension://abc" },
    body: JSON.stringify({ username: "alice", password: "x".repeat(MAX_BODY_BYTES), name: "A" }),
  });

  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "That's too much to save in one go." });
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("chrome-extension://abc");
  expect(signup).not.toHaveBeenCalled();
});

const bytes = (body: object) => new TextEncoder().encode(JSON.stringify(body)).length;

test("the longest task or note the API takes fits in a request, at four bytes a character", () => {
  const title = "😀".repeat(MAX_TITLE);
  const text = "😀".repeat(MAX_TEXT);
  expect(bytes({ title, content: text })).toBeLessThan(MAX_BODY_BYTES);
  expect(bytes({ title, description: text })).toBeLessThan(MAX_BODY_BYTES);
});

test("a list's delete naming the most tasks it can fits in a request", () => {
  const taskIds = Array.from({ length: MAX_TASK_IDS }, () => "i".repeat(MAX_ID));
  expect(bytes({ id: "i".repeat(MAX_ID), tasks: "delete", taskIds })).toBeLessThan(MAX_BODY_BYTES);
});

test("a field past its length is refused with a message saying how long it may be", async () => {
  const res = await signUp({ username: "alice", password: "long enough", name: "A".repeat(201) });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Name can be at most 200 characters" });
});

test("a new username in another script is refused", async () => {
  const res = await signUp({ username: "аlice", password: "long enough", name: "Alice" });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: "Username can have only letters, numbers, dots, dashes and underscores",
  });
});

test("every route behind the auth middleware declares its 401, and a public one only when it throws one", async () => {
  const doc = await (await app.request("/api/openapi.json")).json();
  const declaring = Object.entries<Record<string, { responses: Record<string, unknown> }>>(
    doc.paths,
  ).flatMap(([path, operations]) =>
    Object.entries(operations).map(([method, { responses }]) => ({
      route: `${method.toUpperCase()} ${path}`,
      public: path.startsWith("/api/auth/") || path === "/api/config",
      declares401: "401" in responses,
    })),
  );

  expect(declaring.filter((r) => !r.public && !r.declares401)).toEqual([]);
  expect(declaring.filter((r) => r.public && r.declares401).map((r) => r.route)).toEqual([
    "POST /api/auth/login",
    "POST /api/auth/logout",
  ]);
});
