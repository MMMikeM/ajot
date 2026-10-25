import type { BrowserContext, Worker } from "@playwright/test";

/**
 * Starts a service worker's registration as a push or a periodic sync would, on a worker Chrome
 * has stopped, as it does once one is idle. Over CDP, so Chromium only.
 */
const wakeWorker = async (
  context: BrowserContext,
  origin: string,
  send: (cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>>, id: string) => Promise<void>,
) => {
  const blank = await context.newPage();
  const cdp = await context.newCDPSession(blank);
  // Only reported when it changes, so stopping the worker also tells us its registration
  const stopped = new Promise<string>((found) => {
    cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
      const match = versions.find(
        (v) => v.scriptURL.startsWith(origin) && v.runningStatus === "stopped",
      );
      if (match) found(match.registrationId);
    });
  });
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await send(cdp, await stopped);
  await blank.close();
};

export const deliverPush = (context: BrowserContext, origin: string, payload: object) =>
  wakeWorker(context, origin, async (cdp, registrationId) => {
    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId,
      data: JSON.stringify(payload),
    });
  });

export const dispatchPeriodicSync = (context: BrowserContext, origin: string, tag: string) =>
  wakeWorker(context, origin, async (cdp, registrationId) => {
    await cdp.send("ServiceWorker.dispatchPeriodicSyncEvent", { origin, registrationId, tag });
  });

/** The task titles saved for a page opened offline, or null before the first save. */
export const savedTitles = (worker: Worker) =>
  worker.evaluate(
    () =>
      new Promise<string[] | null>((done) => {
        const open = indexedDB.open("newtab-todo-snapshot");
        // Not saved yet: creating it here would leave the app a database with no store
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction("queries").objectStore("queries").get("tasks");
          read.onsuccess = () => {
            db.close();
            const tasks = read.result as { title: string }[] | undefined;
            done(tasks ? tasks.map((task) => task.title) : null);
          };
        };
        open.onerror = () => done(null);
      }),
  );
