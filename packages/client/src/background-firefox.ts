import { toNotification, type PushPayload } from "@newtab-todo/shared/push-payload";
import {
  EVENTS_PATH,
  SSE_DATA_CHANGED,
  SSE_NOTIFICATION,
  MSG_TOKEN_CHANGED,
  MSG_GET_STATUS,
  MSG_BG_STATUS,
} from "~/lib/constants";
import { createBackoff } from "~/lib/sync/backoff";
import { trackSyncState } from "~/lib/sync/sync-state";
import { getStoredSession, notifyTabs } from "~/lib/ext";
import { setupContextMenu } from "~/lib/context-menu";
import { prewarmPeriodically, prewarmSnapshot } from "~/lib/sync/prewarm-extension";

// Changes arrive in bursts (a drag, Clear done); save the lists once after the last of them
const PREWARM_DELAY_MS = 1000;
let prewarmTimer: ReturnType<typeof setTimeout> | undefined;
const schedulePrewarm = () => {
  clearTimeout(prewarmTimer);
  prewarmTimer = setTimeout(() => void prewarmSnapshot(), PREWARM_DELAY_MS);
};

// The add-on has no Web Push, so what the server notifies arrives on the event stream. Like
// Chrome's extension, it has no Settings, so no kind is turned off.
const notificationUrls = new Map<string, string>();
const showNotification = async (payload: PushPayload) => {
  const notification = toNotification(payload);
  // Firefox for Android has no notifications API
  if (!notification || !browser.notifications) return;
  const id = await browser.notifications.create({
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-192.png"),
    title: notification.title,
    message: notification.body,
  });
  notificationUrls.set(id, notification.url);
};
// The context menu's notifications aren't in the map, so clicking one opens nothing
browser.notifications?.onClicked.addListener((id) => {
  const url = notificationUrls.get(id);
  if (!url) return;
  void browser.notifications.clear(id);
  void browser.tabs.create({ url: browser.runtime.getURL(`index.html#${url}`) });
});
browser.notifications?.onClosed.addListener((id) => notificationUrls.delete(id));

let eventSource: EventSource | null = null;
let connectAttempt = 0;

// No open tab is listening when the page sends this, so it rejects
const syncState = trackSyncState((state) => {
  browser.runtime.sendMessage({ type: MSG_BG_STATUS, state }).catch(() => {});
});

const backoff = createBackoff(() => {
  connect().catch((err) => console.error("[bg-sse] retry error:", err));
});

const disconnect = () => {
  backoff.cancel();
  eventSource?.close();
  eventSource = null;
};

const connect = async () => {
  disconnect();

  // Two calls can overlap (online fires twice, or a token change lands mid-retry); only the
  // latest may open a stream, or the earlier one is orphaned and never closed
  const attempt = ++connectAttempt;
  const session = await getStoredSession();
  if (attempt !== connectAttempt) return;
  if (!session) {
    console.log("[bg-sse] signed out, not connecting");
    syncState.stopped();
    return;
  }

  syncState.connecting();
  const url = `${session.serverUrl}${EVENTS_PATH}?token=${encodeURIComponent(session.token)}`;
  console.log("[bg-sse] connecting...");
  const source = new EventSource(url);
  eventSource = source;

  source.addEventListener(SSE_DATA_CHANGED, (e: MessageEvent) => {
    console.log("[bg-sse] data-changed event received");
    schedulePrewarm();
    if (e.data) {
      try {
        const payload = JSON.parse(e.data);
        browser.runtime.sendMessage({ type: "SSE_MUTATION", payload }).catch(() => {});
        return;
      } catch {
        // fall through to generic notify
      }
    }
    void notifyTabs();
  });

  source.addEventListener(SSE_NOTIFICATION, (e: MessageEvent) => {
    try {
      showNotification(JSON.parse(e.data) as PushPayload).catch(console.error);
    } catch (err) {
      console.error("[bg-sse] unreadable notification:", err);
    }
  });

  source.addEventListener("open", () => {
    console.log("[bg-sse] connected");
    syncState.opened();
    backoff.reset();
    void notifyTabs();
    schedulePrewarm();
  });

  source.onerror = () => {
    if (eventSource !== source) return;
    syncState.failed();
    if (source.readyState !== EventSource.CLOSED) {
      console.log("[bg-sse] connection error, will auto-reconnect");
      return;
    }
    eventSource = null;
    const delayMs = backoff.schedule();
    if (delayMs !== null) console.log(`[bg-sse] connection closed, retrying in ${delayMs / 1000}s`);
  };
};

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === MSG_TOKEN_CHANGED) {
    console.log("[bg-sse] token changed, reconnecting");
    backoff.reset();
    syncState.restart();
    connect().catch((err) => console.error("[bg-sse] reconnect error:", err));
  } else if (type === MSG_GET_STATUS) {
    sendResponse({ type: MSG_BG_STATUS, state: syncState.get() });
  }
});

addEventListener("offline", () => {
  console.log("[bg-sse] offline");
  disconnect();
  syncState.stopped();
});
addEventListener("online", () => {
  if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;
  console.log("[bg-sse] back online, reconnecting");
  backoff.reset();
  syncState.restart();
  connect().catch((err) => console.error("[bg-sse] reconnect error:", err));
});

connect().catch((err) => console.error("[bg-sse] initial connect error:", err));
setupContextMenu();
prewarmPeriodically();

console.log("[bg-sse] persistent background page loaded");
