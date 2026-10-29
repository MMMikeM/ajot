/// <reference lib="webworker" />

import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { toNotification, type PushMessage } from "@newtab-todo/shared/push-payload";
import { MSG_BUILD_VERSION, MSG_SYNC_ALL } from "@newtab-todo/shared/constants";
import { createPrewarm, filesRunOf } from "~/lib/sync/prewarm";
import { syncFiles } from "~/lib/files/file-job";
import { readWorkerSession } from "~/lib/sync/worker-session";
import { createUploadSender } from "~/lib/files/sender";
import { retryWaitingNow } from "~/lib/files/store";

declare let self: ServiceWorkerGlobalScope;

const prewarmLists = createPrewarm(readWorkerSession);
// The files after the lists, outside prewarm's queue, so a later push's rows never wait on bytes
const prewarm = (rows?: Parameters<typeof prewarmLists>[0]) =>
  prewarmLists(rows).then((run) => (run ? syncFiles(filesRunOf(run)) : undefined));

// A push gives the worker about 30 s, so a bigger file waits for a Background Sync or a page; a
// sync, which the browser fires once the device is online, can take minutes
const MAX_PUSH_UPLOAD_BYTES = 5 * 1024 * 1024;
const sendSmallUploads = createUploadSender(readWorkerSession, {
  only: (upload) => upload.row.size <= MAX_PUSH_UPLOAD_BYTES,
});
const sendUploads = createUploadSender(readWorkerSession);

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "pages-cache",
      networkTimeoutSeconds: 3,
      plugins: [
        new ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 24 * 60 * 60,
        }),
        // Offline, a page never opened before (a notification's /task/<id>) has nothing cached.
        // Every path is the same app shell, as the server serves index.html for all of them.
        { handlerDidError: () => matchPrecache("/index.html") },
      ],
    }),
  ),
);

registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  }),
);

self.addEventListener("install", () => self.skipWaiting());
// A page offers a reload when the worker that took it over is a newer build than its own
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === MSG_BUILD_VERSION)
    event.source?.postMessage({ type: MSG_BUILD_VERSION, version: __BUILD_VERSION__ });
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  console.log(`[sw] activated: ${__BUILD_VERSION__}`);
  event.waitUntil(self.clients.claim());
});

// Push: web subscriptions only receive visible notifications; silent sync goes to extensions.
self.addEventListener("push", (event: PushEvent) => {
  const payload = event.data?.json() as PushMessage | undefined;
  if (!payload?.type) return;

  const notification = toNotification(payload);
  if (!notification) return;

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: "/icons/icon-192.png",
        data: { url: notification.url },
        // Sent for every change, so it stays one notification and makes no sound
        ...(payload.type === "changes" && { tag: "changes", silent: true }),
      }),
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: MSG_SYNC_ALL });
        }
      }),
      prewarm(payload.rows),
      sendSmallUploads(),
    ]),
  );
});

type SyncEvent = ExtendableEvent & { tag: string };

// Registered by lib/attachments/queue.ts each time a page queues a file
self.addEventListener("sync", (event) => {
  const sync = event as SyncEvent;
  if (sync.tag === "ajot-uploads")
    sync.waitUntil(retryWaitingNow().catch(console.error).then(sendUploads));
});

type PeriodicSyncEvent = ExtendableEvent & { tag: string };

// Registered by lib/sync/register-sw.ts
self.addEventListener("periodicsync", (event) => {
  const periodic = event as PeriodicSyncEvent;
  if (periodic.tag === "prewarm") periodic.waitUntil(prewarm());
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const path = (event.notification.data as { url?: string })?.url ?? "/";
  const url = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      for (const client of await self.clients.matchAll({ type: "window" })) {
        // Firefox for Android can come to the front without switching to the tab, or refuse to.
        // Unless the tab really has focus, open the task in a window of its own.
        try {
          const focused = await client.focus();
          if (!focused.focused) continue;
          if (await focused.navigate(url)) return;
        } catch {
          continue;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
