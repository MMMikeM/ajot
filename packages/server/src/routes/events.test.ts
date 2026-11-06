import { afterEach, expect, test, vi } from "vite-plus/test";
import { registerClient, unregisterClient } from "../broadcast";
import { issueTicket } from "../stream-tickets";
import { eventsRoute } from "./events";

vi.mock("../push-queue", () => ({ queueChanges: vi.fn() }));

const open = Array.from({ length: 100 }, () => ({ write: vi.fn(), close: vi.fn() }));
afterEach(() => {
  for (const writer of open) unregisterClient("alice", writer);
  vi.useRealTimers();
});

test("a stream past an account's hundred is refused, and the ones open stay open", async () => {
  for (const writer of open) registerClient("alice", writer);

  const res = await eventsRoute.request(`/?ticket=${issueTicket("alice")}`);

  expect(res.status).toBe(429);
  for (const writer of open) expect(writer.close).not.toHaveBeenCalled();
});

test("below the hundred, a stream opens", async () => {
  for (const writer of open.slice(1)) registerClient("alice", writer);

  const res = await eventsRoute.request(`/?ticket=${issueTicket("alice")}`);

  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  await res.body?.cancel();
});

test("a ticket opens one stream: a second use, as a reconnect would make, is refused", async () => {
  const ticket = issueTicket("alice");

  const first = await eventsRoute.request(`/?ticket=${ticket}`);
  await first.body?.cancel();
  const again = await eventsRoute.request(`/?ticket=${ticket}`);

  expect(first.status).toBe(200);
  expect(again.status).toBe(401);
});

test("a ticket left unused past its minute opens nothing", async () => {
  vi.useFakeTimers();
  const ticket = issueTicket("alice");
  vi.advanceTimersByTime(60_001);

  const res = await eventsRoute.request(`/?ticket=${ticket}`);

  expect(res.status).toBe(401);
});
