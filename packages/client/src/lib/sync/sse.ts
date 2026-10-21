import { useSyncExternalStore } from "react";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { tasksCollection, categoriesCollection, notesCollection } from "~/lib/db/collections";
import { ensurePushRegistered } from "~/lib/sync/push";
import { createBackoff } from "~/lib/sync/backoff";
import { getBuildTarget } from "~/lib/build-target";
import { serverUrl } from "~/lib/api";
import { ext } from "~/lib/ext";
import {
  SSE_DATA_CHANGED,
  EVENTS_PATH,
  MSG_GET_STATUS,
  MSG_BG_STATUS,
  MSG_SYNC_ALL,
} from "~/lib/constants";
import type { MutationEvent } from "~/lib/constants";
import { createExternalStore } from "~/lib/external-store";
import { offline } from "~/lib/db/offline";

let es: EventSource | null = null;

// Firefox's persistent MV2 background page holds the SSE connection for every tab. Chrome's MV3
// service worker can't hold an EventSource, so each Chrome tab connects itself.
const backgroundHoldsSse = () => location.protocol === "moz-extension:";

export type SyncState = "disconnected" | "connecting" | "connected";
const syncStateStore = createExternalStore<SyncState>("disconnected");
export const useSyncState = syncStateStore.useStore;

// ─── Pending mutations ────────────────────────────────────────────────────────
// Polls the offline executor for unreconciled optimistic writes.
// Lazy: interval only runs while at least one component is subscribed.

let pendingSnapshot = 0;
const pendingListeners = new Set<() => void>();
let pendingInterval: ReturnType<typeof setInterval> | null = null;

const subscribePending = (cb: () => void) => {
  pendingListeners.add(cb);
  if (pendingListeners.size === 1) {
    pendingInterval = setInterval(() => {
      const next = offline.getPendingCount() + offline.getRunningCount();
      if (next !== pendingSnapshot) {
        pendingSnapshot = next;
        pendingListeners.forEach((fn) => fn());
      }
    }, 200);
  }
  return () => {
    pendingListeners.delete(cb);
    if (pendingListeners.size === 0 && pendingInterval !== null) {
      clearInterval(pendingInterval);
      pendingInterval = null;
    }
  };
};

/** True while any optimistic mutations have not yet been confirmed by the server. */
export const usePendingMutations = () =>
  useSyncExternalStore(subscribePending, () => pendingSnapshot) > 0;

const collectionMap = {
  tasks: tasksCollection,
  categories: categoriesCollection,
  notes: notesCollection,
} as const;

const refetchAll = () => {
  tasksCollection.utils.refetch().catch(console.error);
  categoriesCollection.utils.refetch().catch(console.error);
  notesCollection.utils.refetch().catch(console.error);
};

const writeMutation = (
  collection: (typeof collectionMap)[keyof typeof collectionMap],
  event: MutationEvent,
) => {
  switch (event.action) {
    case "insert":
      console.log(`[sse] writeUpsert → ${event.model}`);
      return collection.utils.writeUpsert(event.data as never);
    case "update":
      console.log(`[sse] writeUpdate → ${event.model}`);
      return collection.utils.writeUpdate(event.data as never);
    case "delete":
      console.log(`[sse] writeDelete → ${event.model}`);
      return collection.utils.writeDelete((event.data as { id: string }).id);
    default:
      console.log(`[sse] unknown action ${String(event.action)}, refetching all`);
      refetchAll();
  }
};

const applyMutation = async (event: MutationEvent) => {
  console.log(`[sse] received ${event.model}.${event.action}`, event.data);
  const collection = collectionMap[event.model];
  if (!collection) {
    console.log("[sse] unknown model, refetching all");
    refetchAll();
    return;
  }
  try {
    await writeMutation(collection, event);
  } catch (err) {
    // e.g. an update for a row this device never received
    console.error("[sse] write rejected, refetching all", err);
    refetchAll();
  }
};

const handleSSEData = (data: string) => {
  if (!data) {
    refetchAll();
    return;
  }
  try {
    const event = JSON.parse(data) as MutationEvent;
    void applyMutation(event);
  } catch {
    refetchAll();
  }
};

const sseBackoff = createBackoff(() => connectSSE());

const connectSSE = () => {
  sseBackoff.cancel();
  const token = getAuthToken();
  if (!token) {
    syncStateStore.set("disconnected");
    return;
  }

  syncStateStore.set("connecting");
  const origin = getBuildTarget() === "extension" ? serverUrl : "";
  const url = `${origin}${EVENTS_PATH}?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);
  es = source;
  source.addEventListener(SSE_DATA_CHANGED, (e: MessageEvent) => {
    handleSSEData(e.data);
  });
  source.addEventListener("open", () => {
    syncStateStore.set("connected");
    sseBackoff.reset();
    refetchAll();
  });
  source.addEventListener("error", () => {
    syncStateStore.set("connecting");
    if (source.readyState !== EventSource.CLOSED || es !== source) return;
    es = null;
    sseBackoff.schedule();
  });
};

const reconnect = () => {
  sseBackoff.cancel();
  sseBackoff.reset();
  es?.close();
  es = null;
  syncStateStore.set("disconnected");
  if (getAuthToken()) {
    connectSSE();
    if (getBuildTarget() === "browser") ensurePushRegistered().catch(console.error);
  }
};

const listenExtensionMessages = () => {
  ext.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; payload?: MutationEvent };
    if (msg?.type === "SSE_MUTATION" && msg.payload) {
      // Any message from the background page means the SSE connection is alive.
      syncStateStore.set("connected");
      void applyMutation(msg.payload);
    } else if (msg?.type === MSG_SYNC_ALL) {
      if (backgroundHoldsSse()) syncStateStore.set("connected");
      // A tab with its own open SSE stream already applied the change this push announces.
      else if (es?.readyState === EventSource.OPEN) return;
      refetchAll();
    }
  });
};

const listenSwMessages = () => {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === MSG_SYNC_ALL) refetchAll();
  });
};

export const initSync = () => {
  const target = getBuildTarget();
  if (target === "browser" || (target === "extension" && !backgroundHoldsSse())) {
    if (!es && getAuthToken()) connectSSE();
    subscribeAuthToken(reconnect);
  }
  if (target === "browser") listenSwMessages();
  if (target === "extension") {
    listenExtensionMessages();
    if (!backgroundHoldsSse()) return;
    // Probe the background page for its current SSE connection state so the
    // indicator isn't stuck at "Offline" on fresh tab load.
    ext.runtime
      .sendMessage({ type: MSG_GET_STATUS })
      .then((resp: unknown) => {
        const r = resp as { type?: string; connected?: boolean };
        if (r?.type === MSG_BG_STATUS && r.connected) syncStateStore.set("connected");
      })
      .catch(() => {}); // background not yet ready — first SYNC_* message will update state
  }
};
