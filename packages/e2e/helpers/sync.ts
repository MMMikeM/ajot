import type { Page, Request } from "@playwright/test";

export type SyncTracker = {
  waitForSync: (timeoutMs?: number) => Promise<void>;
  assertNoFailures: () => void;
};

/** GETs and the event stream's ticket don't count: neither is a change being sent. */
export const createSyncTracker = (page: Page): SyncTracker => {
  const inflight = new Set<Request>();
  const failures: { url: string; status: number }[] = [];

  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/api/") && !path.startsWith("/api/events") && req.method() !== "GET") {
      inflight.add(req);
    }
  });

  page.on("requestfinished", async (req) => {
    if (!inflight.has(req)) return;
    inflight.delete(req);
    const res = await req.response();
    if (res && res.status() >= 400) {
      failures.push({ url: req.url(), status: res.status() });
    }
  });

  page.on("requestfailed", (req) => {
    if (!inflight.has(req)) return;
    inflight.delete(req);
    failures.push({ url: req.url(), status: 0 });
  });

  return {
    waitForSync: async (timeoutMs = 5000) => {
      // A request the page just started may not have fired its request event yet
      await new Promise<void>((r) => setTimeout(r, 50));

      const deadline = Date.now() + timeoutMs;
      while (inflight.size > 0) {
        if (Date.now() > deadline) {
          const pending = [...inflight].map((r) => r.url()).join(", ");
          throw new Error(`waitForSync timed out after ${timeoutMs} ms. Still pending: ${pending}`);
        }
        await new Promise<void>((r) => setTimeout(r, 50));
      }
    },

    assertNoFailures: () => {
      if (failures.length === 0) return;
      const lines = failures
        .map((f) => `  ${f.status === 0 ? "network error" : f.status}  ${f.url}`)
        .join("\n");
      throw new Error(`API requests failed during test:\n${lines}`);
    },
  };
};
