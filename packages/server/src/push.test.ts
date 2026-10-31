import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { InvalidSubscriptionError, sendPushBatch } from "@mmmike/web-push/send";
import * as metricRepo from "./db/metric.repo";
import { sendPush } from "./push";

vi.mock("@mmmike/web-push/send", async (actual) => ({
  ...(await actual<typeof import("@mmmike/web-push/send")>()),
  sendPushBatch: vi.fn(),
}));
vi.mock("./db/metric.repo", () => ({ add: vi.fn(async () => {}) }));
vi.mock("./db/push-subscription.repo", () => ({ removeMany: vi.fn(async () => {}) }));
vi.mock("./db/push-preference.repo", () => ({}));

const sub = (endpoint: string) => ({ endpoint, p256dh: "", auth: "", createdAt: "" });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("each try is counted by what the push services answered", async () => {
  vi.mocked(sendPushBatch).mockResolvedValue({
    delivered: 2,
    gone: ["old-phone"],
    failed: [
      { endpoint: "offline", error: new TypeError("fetch failed") },
      { endpoint: "broken", error: new InvalidSubscriptionError("no keys") },
    ],
  } as never);
  await sendPush(["a", "b", "old-phone", "offline", "broken"].map(sub), {
    type: "task-shared",
  } as never);
  expect(vi.mocked(metricRepo.add).mock.calls[0]?.[0]).toEqual(
    new Map([
      ["push-sent:task-shared:ok", 2],
      ["push-sent:task-shared:gone", 1],
      ["push-sent:task-shared:typeerror", 1],
      ["push-sent:task-shared:invalid", 1],
    ]),
  );
});
