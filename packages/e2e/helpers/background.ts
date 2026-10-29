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

export const dispatchSync = (context: BrowserContext, origin: string, tag: string) =>
  wakeWorker(context, origin, async (cdp, registrationId) => {
    await cdp.send("ServiceWorker.dispatchSyncEvent", {
      origin,
      registrationId,
      tag,
      lastChance: false,
    });
  });

/** A text file queued for `taskId` as a page that then closed leaves it, in `ajot-files`. */
export const queueUpload = (
  worker: Worker,
  {
    id,
    taskId,
    uploaderId,
    text,
  }: { id: string; taskId: string; uploaderId: string; text: string },
) =>
  worker.evaluate(
    ({ id, taskId, uploaderId, text }) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open("ajot-files", 1);
        // As lib/files/store.ts creates it
        open.onupgradeneeded = () => {
          open.result.createObjectStore("blobs");
          open.result.createObjectStore("uploads");
        };
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["blobs", "uploads"], "readwrite");
          const blob = new Blob([text], { type: "text/plain" });
          const at = new Date().toISOString();
          tx.objectStore("blobs").put(
            { blob, userId: uploaderId, pinned: true, savedAt: Date.now() },
            `${id}:file`,
          );
          tx.objectStore("uploads").put(
            {
              row: {
                id,
                taskId,
                name: "note.txt",
                mimeType: "text/plain",
                size: blob.size,
                thumbhash: null,
                hasThumb: false,
                createdAt: at,
                updatedAt: at,
              },
              uploaderId,
              posted: false,
              serverDeleted: false,
              attempts: 0,
              retryAt: 0,
              sizeMismatches: 0,
            },
            id,
          );
          tx.oncomplete = () => {
            db.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    { id, taskId, uploaderId, text },
  );

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
