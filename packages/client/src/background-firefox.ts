import {
  TOKEN_KEY,
  EVENTS_PATH,
  SSE_DATA_CHANGED,
  MSG_TOKEN_CHANGED,
  MSG_GET_STATUS,
  MSG_BG_STATUS,
} from "~/lib/constants";

declare const __SERVER_URL__: string;

// One message is enough: tabs refetch every collection on any SYNC_* type.
const notifyTabsFallback = () => {
  browser.runtime.sendMessage({ type: "SYNC_ALL" }).catch(() => {});
};

let eventSource: EventSource | null = null;
let isConnected = false;

// EventSource retries network errors itself, but an HTTP error response (a 502 from Fly's
// proxy while the machine resumes or redeploys) closes it for good. This page lives as long as
// the browser does, so without a retry it would stay disconnected until Firefox restarts.
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;
let retryMs = MIN_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleRetry = () => {
  if (retryTimer !== null) return;
  console.log(`[bg-sse] connection closed, retrying in ${retryMs / 1000}s`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect().catch((err) => console.error("[bg-sse] retry error:", err));
  }, retryMs);
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
};

const connect = async () => {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  eventSource?.close();
  eventSource = null;

  const result = await browser.storage.local.get(TOKEN_KEY);
  const token = result[TOKEN_KEY];
  if (!token) {
    console.log("[bg-sse] no token, not connecting");
    return;
  }

  const url = `${__SERVER_URL__}${EVENTS_PATH}?token=${encodeURIComponent(token)}`;
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
    notifyTabsFallback();
  });

  source.addEventListener("open", () => {
    console.log("[bg-sse] connected");
    isConnected = true;
    retryMs = MIN_RETRY_MS;
    notifyTabsFallback();
  });

  source.onerror = () => {
    isConnected = false;
    if (source.readyState !== EventSource.CLOSED || eventSource !== source) {
      console.log("[bg-sse] connection error, will auto-reconnect");
      return;
    }
    eventSource = null;
    scheduleRetry();
  };
};

browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const type = (message as { type?: string })?.type;
  if (type === MSG_TOKEN_CHANGED) {
    console.log("[bg-sse] token changed, reconnecting");
    retryMs = MIN_RETRY_MS;
    connect().catch((err) => console.error("[bg-sse] reconnect error:", err));
  } else if (type === MSG_GET_STATUS) {
    sendResponse({ type: MSG_BG_STATUS, connected: isConnected });
  }
});

connect().catch((err) => console.error("[bg-sse] initial connect error:", err));

console.log("[bg-sse] persistent background page loaded");
