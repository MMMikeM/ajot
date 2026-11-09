import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import * as widgetCodes from "./widget-codes";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("an approved code signs one widget in, once", () => {
  widgetCodes.approve("code-1", "alice", "session-1");

  expect(widgetCodes.take("code-1")).toMatchObject({ userId: "alice", sessionId: "session-1" });
  expect(widgetCodes.take("code-1")).toBeUndefined();
});

test("a code no one approved claims nothing", () => {
  expect(widgetCodes.take("never-approved")).toBeUndefined();
});

test("an approval lapses after ten minutes", () => {
  widgetCodes.approve("code-2", "alice", "session-1");
  vi.advanceTimersByTime(10 * 60_000);

  expect(widgetCodes.take("code-2")).toBeUndefined();
});
