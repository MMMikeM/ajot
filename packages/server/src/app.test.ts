import { expect, test, vi } from "vite-plus/test";
import app from "./app";
import { signup } from "./auth-service";

vi.mock("./db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("./auth-service", () => ({ login: vi.fn(), signup: vi.fn() }));

// routes/auth.test.ts mounts the hook itself; this is the app the server runs
const signUp = (body: object) =>
  app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
