import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { shareSessionWithWorker, workerSignedOut } from "~/lib/sync/worker-session";

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// The worker unsubscribes a signed-out device, so a store no page has written since it was
// recreated must not read as signed out: that would end push for an account still signed in
test("the worker tells signing out from a session no page has shared", async () => {
  expect(await workerSignedOut()).toBe(false);

  await shareSessionWithWorker("token", "user-1");
  expect(await workerSignedOut()).toBe(false);

  await shareSessionWithWorker(null, null);
  expect(await workerSignedOut()).toBe(true);
});
