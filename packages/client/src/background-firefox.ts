import {
  EVENTS_PATH,
  SSE_DATA_CHANGED,
  MSG_TOKEN_CHANGED,
  MSG_GET_STATUS,
  MSG_BG_STATUS,
} from "~/lib/constants";
import { createBackoff } from "~/lib/sync/backoff";
import { getStoredSession, notifyTabs } from "~/lib/ext";
import { setupContextMenu } from "~/lib/context-menu";

let eventSource: EventSource | null = null;
let isConnected = false;

const backoff = createBackoff(() => {
  connect().catch((err) => console.error("[bg-sse] retry error:", err));
});

const connect = async () => {
  backoff.cancel();
  eventSource?.close();
  eventSource = null;

  const session = await getStoredSession();
  if (!session) {
    console.log("[bg-sse] signed out, not connecting");
    return;
  }

  const url = `${session.serverUrl}${EVENTS_PATH}?token=${encodeURIComponent(session.token)}`;
  console.log("[bg-sse] connecting...");
  const source = new EventSource(url);
  eventSource = source;

  source.addEventListener(SSE_DATA_CHANGED, (e: MessageEvent) => {
    console.log("[bg-sse] data-changed event received");
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

  source.addEventListener("open", () => {
    console.log("[bg-sse] connected");
    isConnected = true;
    backoff.reset();
    void notifyTabs();
  });

  source.onerror = () => {
    isConnected = false;
    if (source.readyState !== EventSource.CLOSED || eventSource !== source) {
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
    connect().catch((err) => console.error("[bg-sse] reconnect error:", err));
  } else if (type === MSG_GET_STATUS) {
    sendResponse({ type: MSG_BG_STATUS, connected: isConnected });
  }
});

connect().catch((err) => console.error("[bg-sse] initial connect error:", err));
setupContextMenu();

console.log("[bg-sse] persistent background page loaded");
