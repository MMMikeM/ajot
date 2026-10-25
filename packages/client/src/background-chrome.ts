/// <reference lib="webworker" />

// Chrome MV3 background. A service worker can't hold an EventSource, so new-tab pages open their
// own (lib/sync/sse.ts). This worker owns the extension's Web Push subscription instead: Chrome
// 121+ lets extensions subscribe with userVisibleOnly: false, so silent "sync" pushes are allowed
// here (unlike in the PWA) and wake the worker even with no tabs open.

import { sendSubscriptionToServer, subscribe, unsubscribe } from "@mmmike/web-push/client";
import { toNotification, type PushPayload } from "@newtab-todo/shared/push-payload";
import { MSG_TOKEN_CHANGED } from "@newtab-todo/shared/constants";
import { ext, getStoredSession, notifyTabs } from "~/lib/ext";
import { fetchServerConfig } from "~/lib/server-config";
import { setupContextMenu } from "~/lib/context-menu";

declare let self: ServiceWorkerGlobalScope;

type Session = NonNullable<Awaited<ReturnType<typeof getStoredSession>>>;

const upload = async (subscription: PushSubscription, { token, serverUrl }: Session) => {
  const ok = await sendSubscriptionToServer(
    subscription,
    `${serverUrl}/api/push/subscribe?kind=extension`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!ok) throw new Error("subscription upload failed");
};

/**
 * Match the push subscription to the sign-in state: subscribed and uploaded while signed in,
 * unsubscribed when signed out (the server prunes the row as "gone" on its next send).
 */
const reconcileSubscription = async () => {
  const session = await getStoredSession();
  if (!session) {
    await unsubscribe({ registration: self.registration });
    console.log("[bg-push] signed out, unsubscribed");
    return;
  }
  // Each server has its own key; subscribe() replaces a subscription made with another one
  const { vapidPublicKey } = await fetchServerConfig(session.serverUrl);
  if (!vapidPublicKey) throw new Error("the server has no VAPID_PUBLIC_KEY");
  const result = await subscribe(vapidPublicKey, {
    registration: self.registration,
    userVisibleOnly: false,
  });
  if (result.status !== "subscribed") throw new Error(`push ${result.status}`);
  await upload(result.subscription, session);
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

const showNotification = (payload: PushPayload) => {
  const notification = toNotification(payload);
  if (!notification) return Promise.resolve();
  return self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: ext.runtime.getURL("icons/icon-192.png"),
  });
};

setupContextMenu();
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
