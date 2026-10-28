import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerClient, unregisterClient } from "../broadcast";
import { eventsRoute } from "./events";

vi.mock("../auth", () => ({
  extractToken: vi.fn(() => undefined),
  validateSession: vi.fn(async () => "alice"),
}));
vi.mock("../push-queue", () => ({ queueChanges: vi.fn() }));

const open = Array.from({ length: 100 }, () => ({ write: vi.fn(), close: vi.fn() }));
afterEach(() => {
  for (const writer of open) unregisterClient("alice", writer);
});

test("a stream past an account's hundred is refused, and the ones open stay open", async () => {
  for (const writer of open) registerClient("alice", writer);

  const res = await eventsRoute.request("/?token=t");

  expect(res.status).toBe(429);
  for (const writer of open) expect(writer.close).not.toHaveBeenCalled();
});

test("below the hundred, a stream opens", async () => {
  for (const writer of open.slice(1)) registerClient("alice", writer);

  const res = await eventsRoute.request("/?token=t");

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  await res.body?.cancel();
});
