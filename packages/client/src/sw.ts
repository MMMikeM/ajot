/// <reference lib="webworker" />

import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import {
  toNotification,
  type PushMessage,
  type ShownNotification,
} from "@newtab-todo/shared/push-payload";
import { MSG_BUILD_VERSION, MSG_SYNC_ALL } from "@newtab-todo/shared/constants";
import { createPrewarm, filesRunOf } from "~/lib/sync/prewarm";
import { syncFiles } from "~/lib/files/file-job";
import { readWorkerSession } from "~/lib/sync/worker-session";
import { createUploadSender } from "~/lib/files/sender";
import { retryWaitingNow } from "~/lib/files/store";
import { apiClient, succeeded } from "~/lib/api-client";
import { loadSnapshotEntry } from "~/lib/snapshot-store";
import {
  addToGroup,
  GROUP_TAG,
  GROUPED_KEY,
  type Group,
  type ReplacingOptions,
} from "~/lib/notification-group";

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

// Chrome builds an installed app from the manifest the page fetches, so it comes from the server:
// served from an older build's cache, it made an install with no share target
const MANIFEST = "manifest.webmanifest";
precacheAndRoute(
  self.__WB_MANIFEST.filter(
    (entry) => (typeof entry === "string" ? entry : entry.url) !== MANIFEST,
  ),
);
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

// Counted against the server's push-sent counts, so a push lost on the way, or arriving while
// the app is open, shows up in /api/metrics
const count = async (name: string) => {
  const session = await readWorkerSession();
  if (!session) return;
  await succeeded(apiClient(session).api.metrics.$post({ json: { name } })).catch((err) =>
    console.error(`[sw] couldn't count ${name}:`, err),
  );
};

/** Whether the app was on screen, open behind something else, or not open at all. */
const stateOf = (windows: readonly WindowClient[]) => {
  if (windows.some((window) => window.focused)) return "focused";
  if (windows.some((window) => window.visibilityState === "visible")) return "visible";
  return windows.length > 0 ? "hidden" : "none";
};

const openPages = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });

/** Which page a tap landed on, by its path's kind, never the task's id. */
const landedOn = (client: WindowClient | null) => {
  if (!client) return "none";
  const { pathname } = new URL(client.url);
  if (pathname === "/") return "home";
  if (pathname.startsWith("/task/")) return "task";
  if (pathname.endsWith(".js")) return "script";
  return "other";
};

const ICON = "/icons/icon-192.png";

/**
 * One notification per thing it's about, the newest replacing the last, or with grouping on in
 * Settings, one for everything. "Your lists were updated" makes no sound; anything else replacing
 * an older notification still alerts.
 */
const show = async (notification: ShownNotification) => {
  const sound: ReplacingOptions =
    notification.tag === "changes" ? { silent: true } : { renotify: true };
  if ((await loadSnapshotEntry(GROUPED_KEY)) !== true)
    return self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: ICON,
      tag: notification.tag,
      data: { url: notification.url },
      ...sound,
    });
  const [open] = await self.registration.getNotifications({ tag: GROUP_TAG });
  const grouped = addToGroup((open?.data as { group?: Group } | undefined)?.group, notification);
  return self.registration.showNotification(grouped.title, {
    body: grouped.body,
    icon: ICON,
    tag: GROUP_TAG,
    data: { url: grouped.url, group: grouped.group },
    ...sound,
  });
};

// Push: web subscriptions only receive visible notifications; silent sync goes to extensions.
self.addEventListener("push", (event: PushEvent) => {
  const payload = event.data?.json() as PushMessage | undefined;
  if (!payload?.type) return;

  const received = openPages().then((pages) =>
    count(`push-received:${payload.type}:${stateOf(pages)}`),
  );
  const notification = toNotification(payload);
  if (!notification) return event.waitUntil(received);

  event.waitUntil(
    Promise.all([
      received,
      show(notification),
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

  const open = async () => {
    const windows = await self.clients.matchAll({ type: "window" });
    const before = stateOf(windows);
    for (const client of windows) {
      // Firefox for Android can come to the front without switching to the tab, or refuse to.
      // Unless the tab really has focus, open the task in a window of its own.
      try {
        const focused = await client.focus();
        if (!focused.focused) continue;
        const navigated = await focused.navigate(url);
        if (navigated) return `${before}:navigated-${landedOn(navigated)}`;
      } catch {
        continue;
      }
    }
    try {
      return `${before}:opened-${landedOn(await self.clients.openWindow(url))}`;
    } catch (err) {
      return `${before}:failed-${err instanceof Error ? err.name.toLowerCase() : "error"}`;
    }
  };

  event.waitUntil(open().then((outcome) => count(`notification-click:${outcome}`.slice(0, 64))));
});
