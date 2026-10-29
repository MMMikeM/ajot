import { expect, test, vi } from "vite-plus/test";
import { purgeExpired } from "./db/purge.repo";
import * as sessionRepo from "./db/session.repo";
import { startPurging } from "./purge";

vi.mock("./db/purge.repo", () => ({ purgeExpired: vi.fn(async () => ({})) }));
vi.mock("./db/session.repo", () => ({
  hashStoredTokens: vi.fn().mockRejectedValue(new Error("too many SQL variables")),
}));

test("sessions that can't be hashed leave the purge on its daily schedule", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  startPurging();
  await vi.advanceTimersByTimeAsync(10 * 60_000);

  expect(purgeExpired).toHaveBeenCalledTimes(1);
  expect(sessionRepo.hashStoredTokens).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(24 * 3_600_000);
  expect(purgeExpired).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
