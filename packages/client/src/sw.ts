/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { toNotification, type PushPayload } from "@newtab-todo/shared/push-payload";
import { MSG_SYNC_ALL } from "@newtab-todo/shared/constants";

declare let self: ServiceWorkerGlobalScope;

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
self.addEventListener("activate", (event: ExtendableEvent) => {
  console.log(`[sw] activated: ${__BUILD_VERSION__}`);
  event.waitUntil(self.clients.claim());
});

// Push: web subscriptions only receive visible notifications; silent sync goes to extensions.
self.addEventListener("push", (event: PushEvent) => {
  const payload = event.data?.json() as PushPayload | undefined;
  if (!payload?.type) return;

  const notification = toNotification(payload);
  if (!notification) return;

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(notification.title, {
        body: notification.body,
        icon: "/icons/icon-192.png",
        data: { url: notification.url },
      }),
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: MSG_SYNC_ALL });
        }
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "#/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          void (client as WindowClient).focus();
          void (client as WindowClient).navigate(new URL(url, self.location.origin).href);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
