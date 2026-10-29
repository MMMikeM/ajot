import { useSyncExternalStore } from "react";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getSignedInUserId } from "~/lib/auth/current-user";
import { shareSessionWithBackground } from "~/lib/auth/session";
import {
  tasksCollection,
  categoriesCollection,
  notesCollection,
  contactsCollection,
  attachmentsCollection,
} from "~/lib/db/collections";
import { refreshPushSubscription, registerPushSubscription } from "~/lib/sync/push";
import { createBackoff } from "~/lib/sync/backoff";
import { getBuildTarget } from "~/lib/build-target";
import { getServerUrl } from "~/lib/server-url";
import { ext } from "~/lib/ext";
import {
  SSE_DATA_CHANGED,
  EVENTS_PATH,
  MSG_GET_STATUS,
  MSG_BG_STATUS,
  MSG_SYNC_ALL,
} from "~/lib/constants";
import type { ModelName, MutationEvent } from "~/lib/constants";
import { createExternalStore } from "~/lib/external-store";
import { offline } from "~/lib/db/offline";
import { writeDeleted } from "~/lib/db/synced-writes";
import { trackSyncState, type SyncState } from "~/lib/sync/sync-state";
import { shareSessionWithWorker } from "~/lib/sync/worker-session";
import { checkForUpdate } from "~/lib/sync/register-sw";

let es: EventSource | null = null;

// Firefox's persistent MV2 background page holds the SSE connection for every tab. Chrome's MV3
// service worker can't hold an EventSource, so each Chrome tab connects itself.
const backgroundHoldsSse = () => location.protocol === "moz-extension:";

const syncStateStore = createExternalStore<SyncState>("disconnected");
export const useSyncState = syncStateStore.useStore;
const ownSyncState = trackSyncState(syncStateStore.set);

const countPending = () => offline.getPendingCount() + offline.getRunningCount();

let pendingSnapshot = 0;
const pendingListeners = new Set<() => void>();
let pendingInterval: ReturnType<typeof setInterval> | null = null;

const subscribePending = (cb: () => void) => {
  pendingListeners.add(cb);
  if (pendingListeners.size === 1) {
    pendingInterval = setInterval(() => {
      const next = countPending();
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

export const usePendingMutations = () =>
  useSyncExternalStore(subscribePending, () => pendingSnapshot) > 0;

const collectionMap = {
  tasks: tasksCollection,
  categories: categoriesCollection,
  notes: notesCollection,
  contacts: contactsCollection,
  attachments: attachmentsCollection,
} as const;

const isSynced = (model: ModelName): model is keyof typeof collectionMap => model in collectionMap;

const refetchAll = () => {
  for (const collection of Object.values(collectionMap))
    collection.utils.refetch().catch(console.error);
};

type SyncedCollection = (typeof collectionMap)[keyof typeof collectionMap];

const writeMutation = (collection: SyncedCollection, event: MutationEvent) => {
  switch (event.action) {
    case "insert":
      console.log(`[sse] writeUpsert → ${event.model}`);
      return collection.utils.writeUpsert(event.data as never);
    case "update":
      console.log(`[sse] writeUpdate → ${event.model}`);
      return collection.utils.writeUpdate(event.data as never);
    case "delete":
      console.log(`[sse] writeDelete → ${event.model}`);
      // Already gone, as on the device that made the change once its own response has landed
      return writeDeleted(collection, (event.data as { id: string }).id);
    default:
      console.log(`[sse] unknown action ${String(event.action)}, refetching all`);
      refetchAll();
  }
};

const applyMutation = async (event: MutationEvent) => {
  console.log(`[sse] received ${event.model}.${event.action}`, event.data);
  // A model this build has no collection for has nothing on this page to change
  if (!isSynced(event.model)) return;
  const collection = collectionMap[event.model];
  try {
    // Nothing on this page has read it yet, so it holds no rows to change: load it, which also
    // saves the change for a page opened offline
    if (collection.status !== "ready") await collection.preload();
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

const disconnectSSE = () => {
  sseBackoff.cancel();
  es?.close();
  es = null;
};

const connectSSE = () => {
  disconnectSSE();
  const token = getAuthToken();
  if (!token) {
    ownSyncState.stopped();
    return;
  }

  ownSyncState.connecting();
  const url = `${getServerUrl()}${EVENTS_PATH}?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);
  es = source;
  source.addEventListener(SSE_DATA_CHANGED, (e: MessageEvent) => {
    handleSSEData(e.data);
  });
  source.addEventListener("open", () => {
    ownSyncState.opened();
    sseBackoff.reset();
    refetchAll();
    // The stream drops when a deploy restarts the server, so reopening is the first sign of one
    checkForUpdate();
  });
  source.addEventListener("error", () => {
    if (es !== source) return;
    ownSyncState.failed();
    if (source.readyState !== EventSource.CLOSED) return;
    es = null;
    sseBackoff.schedule();
  });
};

const restartSSE = () => {
  sseBackoff.reset();
  ownSyncState.restart();
  connectSSE();
};

const reconnect = () => {
  restartSSE();
  if (getAuthToken() && getBuildTarget() === "browser") void registerPushSubscription();
};

const listenNetworkChanges = () => {
  window.addEventListener("offline", () => {
    disconnectSSE();
    ownSyncState.stopped();
  });
  window.addEventListener("online", () => {
    if (es && es.readyState !== EventSource.CLOSED) return;
    restartSSE();
  });
};

const listenExtensionMessages = () => {
  ext.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string; payload?: MutationEvent; state?: SyncState };
    if (msg?.type === MSG_BG_STATUS && msg.state && backgroundHoldsSse()) {
      syncStateStore.set(msg.state);
    } else if (msg?.type === "SSE_MUTATION" && msg.payload) {
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
    listenNetworkChanges();
  }
  if (target === "browser") {
    listenSwMessages();
    const shareSession = () => void shareSessionWithWorker(getAuthToken(), getSignedInUserId());
    shareSession();
    if (getAuthToken()) refreshPushSubscription().catch(console.error);
    subscribeAuthToken(shareSession);
  }
  if (target === "extension") {
    listenExtensionMessages();
    shareSessionWithBackground();
    if (!backgroundHoldsSse()) return;
    // The background page broadcasts only later changes, so without asking the indicator would
    // be stuck at "Offline" on a fresh tab.
    syncStateStore.set(navigator.onLine ? "connecting" : "disconnected");
    ext.runtime
      .sendMessage({ type: MSG_GET_STATUS })
      .then((resp: unknown) => {
        const r = resp as { type?: string; state?: SyncState };
        if (r?.type === MSG_BG_STATUS && r.state) syncStateStore.set(r.state);
      })
      .catch(() => {}); // background not yet ready — first SYNC_* message will update state
  }
};
