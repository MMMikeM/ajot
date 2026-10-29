/// <reference lib="webworker" />

// Chrome MV3 background. A service worker can't hold an EventSource, so new-tab pages open their
// own (lib/sync/sse.ts). This worker owns the extension's Web Push subscription instead: Chrome
// 121+ lets extensions subscribe with userVisibleOnly: false, so silent "sync" pushes are allowed
// here (unlike in the PWA) and wake the worker even with no tabs open.

import { sendSubscriptionToServer, subscribe, unsubscribe } from "@mmmike/web-push/client";
import {
  toNotification,
  type PushMessage,
  type PushPayload,
} from "@newtab-todo/shared/push-payload";
import { MSG_TOKEN_CHANGED, SERVER_URL_KEY, TOKEN_KEY } from "@newtab-todo/shared/constants";
import { ext, getStoredSession, notifyTabs } from "~/lib/ext";
import { apiClient, type SignedInSession } from "~/lib/api-client";
import { fetchServerConfig } from "~/lib/server-config";
import { setupContextMenu } from "~/lib/context-menu";
import { createUploadSender } from "~/lib/files/sender";
import { retryWaitingNow } from "~/lib/files/store";
import { prewarmPeriodically, prewarmSnapshot } from "~/lib/sync/prewarm-extension";

declare let self: ServiceWorkerGlobalScope;

const upload = async (subscription: PushSubscription, session: SignedInSession) => {
  const url = apiClient(session).api.push.subscribe.$url({ query: { kind: "extension" } });
  const ok = await sendSubscriptionToServer(subscription, url.href, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (!ok) throw new Error("subscription upload failed");
};

const reconcileSubscription = async () => {
  const session = await getStoredSession();
  if (!session) {
    // The server prunes the row as "gone" on its next send
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
    data: { url: notification.url },
  });
};

// This worker dies about 30 s after it goes idle, and a slower PUT with it: a bigger file waits for
// a tab
const MAX_WORKER_UPLOAD_BYTES = 5 * 1024 * 1024;

const sendUploads = createUploadSender(getStoredSession, {
  only: (upload) => upload.row.size <= MAX_WORKER_UPLOAD_BYTES,
});
const sendWaitingNow = () => retryWaitingNow().catch(console.error).then(sendUploads);

setupContextMenu();
prewarmPeriodically(() => void sendUploads());
// Whatever woke this worker, uploads that were waiting for it go now
void sendWaitingNow();
ext.runtime.onInstalled.addListener(() => {
  void queueReconcile();
  void prewarmSnapshot();
});
ext.runtime.onStartup.addListener(() => {
  void queueReconcile();
  void prewarmSnapshot();
});
// On the storage write itself: the sign-in's runtime message can arrive before it lands
ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (TOKEN_KEY in changes || SERVER_URL_KEY in changes)) {
    void prewarmSnapshot();
    void sendUploads();
  }
});
ext.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: string })?.type === MSG_TOKEN_CHANGED) void queueReconcile();
});
self.addEventListener("pushsubscriptionchange", (event) => {
  (event as ExtendableEvent).waitUntil(queueReconcile());
});

self.addEventListener("push", (event: PushEvent) => {
  const payload = event.data?.json() as PushMessage | undefined;
  // Unpacked extensions can't update themselves, so a deploy needs no action here.
  if (!payload?.type || payload.type === "deploy") return;
  event.waitUntil(
    Promise.all([
      showNotification(payload),
      notifyTabs(),
      prewarmSnapshot(payload.rows),
      sendUploads(),
    ]),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(self.clients.openWindow(ext.runtime.getURL(`index.html#${url}`)));
});
