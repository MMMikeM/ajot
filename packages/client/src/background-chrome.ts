/// <reference lib="webworker" />

// Chrome MV3 background. A service worker can't hold an EventSource, so new-tab pages open their
// own (lib/sync/sse.ts). This worker owns the extension's Web Push subscription instead: Chrome
// 121+ lets extensions subscribe with userVisibleOnly: false, so silent "sync" pushes are allowed
// here (unlike in the PWA) and wake the worker even with no tabs open.

import { hc } from "hono/client";
import { serializeSubscription } from "@mmmike/web-push/client";
import { urlBase64ToUint8Array } from "@mmmike/web-push/vapid";
import { toNotification, type PushPayload } from "@newtab-todo/shared/push-payload";
import type { AppType } from "@newtab-todo/server/app";
import { TOKEN_KEY, MSG_TOKEN_CHANGED } from "@newtab-todo/shared/constants";
import { ext } from "~/lib/ext";

declare let self: ServiceWorkerGlobalScope;
declare const __SERVER_URL__: string;
declare const __VAPID_PUBLIC_KEY__: string;

const getToken = async () =>
  ((await ext.storage.local.get(TOKEN_KEY)) as Record<string, string | undefined>)[TOKEN_KEY];

const isReusable = (subscription: PushSubscription, key: Uint8Array) => {
  if (subscription.options.userVisibleOnly) return false;
  // Browsers that don't report the key keep their subscription rather than churn it.
  const bound = subscription.options.applicationServerKey;
  if (!bound) return true;
  const boundBytes = new Uint8Array(bound);
  return boundBytes.length === key.length && boundBytes.every((byte, i) => byte === key[i]);
};

const subscribe = async () => {
  const key = urlBase64ToUint8Array(__VAPID_PUBLIC_KEY__);
  const existing = await self.registration.pushManager.getSubscription();
  if (existing && isReusable(existing, key)) return existing;
  await existing?.unsubscribe();
  return self.registration.pushManager.subscribe({
    userVisibleOnly: false,
    applicationServerKey: key,
  });
};

const upload = async (subscription: PushSubscription, token: string) => {
  const { endpoint, keys } = serializeSubscription(subscription);
  const api = hc<AppType>(__SERVER_URL__, { headers: { Authorization: `Bearer ${token}` } });
  const res = await api.api.push.subscribe.$post({
    json: { endpoint, p256dh: keys.p256dh, auth: keys.auth, kind: "extension" },
  });
  if (!res.ok) throw new Error(`subscription upload failed: ${res.status}`);
};

/**
 * Match the push subscription to the sign-in state: subscribed and uploaded while signed in,
 * unsubscribed when signed out (the server prunes the row as "gone" on its next send).
 */
const reconcileSubscription = async () => {
  const token = await getToken();
  if (!token) {
    await (await self.registration.pushManager.getSubscription())?.unsubscribe();
    console.log("[bg-push] signed out, unsubscribed");
    return;
  }
  await upload(await subscribe(), token);
  console.log("[bg-push] subscribed");
};

// Install, startup and sign-in changes can land together; run one reconcile at a time.
let reconciling = Promise.resolve();
const queueReconcile = () => {
  reconciling = reconciling
    .then(reconcileSubscription)
    .catch((err) => console.error("[bg-push] subscription error:", err));
  return reconciling;
};

const notifyTabs = () => ext.runtime.sendMessage({ type: "SYNC_ALL" }).catch(() => {});

const showNotification = (payload: PushPayload) => {
  const notification = toNotification(payload);
  if (!notification) return Promise.resolve();
  return self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: ext.runtime.getURL("icons/icon-192.png"),
  });
};

ext.runtime.onInstalled.addListener(() => void queueReconcile());
ext.runtime.onStartup.addListener(() => void queueReconcile());
ext.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string })?.type === MSG_TOKEN_CHANGED) void queueReconcile();
});
self.addEventListener("pushsubscriptionchange", (event) => {
  (event as ExtendableEvent).waitUntil(queueReconcile());
});

self.addEventListener("push", (event: PushEvent) => {
  const payload = event.data?.json() as PushPayload | undefined;
  // Unpacked extensions can't update themselves, so a deploy needs no action here.
  if (!payload?.type || payload.type === "deploy") return;
  event.waitUntil(Promise.all([showNotification(payload), notifyTabs()]));
});

// Notification deep links (#/tasks/<id>) have no matching route yet, so open the app itself.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(ext.runtime.getURL("index.html")));
});
