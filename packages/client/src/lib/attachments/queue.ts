import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getSignedInUserId } from "~/lib/auth/current-user";
import { getServerUrl } from "~/lib/server-url";
import { getBuildTarget } from "~/lib/build-target";
import { attachmentsCollection } from "~/lib/db/collections";
import { retryWaitingNow, subscribeUploads } from "~/lib/files/store";
import { queueFile, type Refusal } from "~/lib/files/attach";
import { createUploadSender } from "~/lib/files/sender";
import { refreshAttachmentsConfig } from "~/lib/attachments/config";
import type { Attachment } from "~/lib/types";

let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Sends what's waiting; a call during a run makes it run again once it's done. */
export const sendUploads = createUploadSender(
  () => {
    const token = getAuthToken();
    return token ? { token, serverUrl: getServerUrl(), userId: getSignedInUserId() } : null;
  },
  {
    // The uploader's page shows it uploaded at once, rather than when its broadcast comes back
    onUploaded: (row) =>
      void attachmentsCollection.utils.writeUpsert(row as Attachment).catch(console.error),
    onRetryAt: (at) => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void sendUploads(), Math.max(0, at - Date.now()));
    },
  },
);

type SyncRegistration = ServiceWorkerRegistration & {
  sync?: { register: (tag: string) => Promise<void> };
};

// The PWA's worker sends it once the device is online, even after this page has closed. Chromium
// only; elsewhere the next open page does.
const sendFromWorkerWhenOnline = () => {
  if (getBuildTarget() !== "browser" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg: SyncRegistration) => reg.sync?.register("ajot-uploads"))
    .catch(console.error);
};

export type Refused = { name: string; reason: Refusal };

/**
 * Saves each file on this device and queues it, so it shows at once and survives the tab closing.
 * Resolves with the files it couldn't add.
 */
export const attachFiles = async (taskId: string, files: File[], maxBytes: number) => {
  const uploaderId = getSignedInUserId();
  if (!uploaderId) return [];
  const refused: Refused[] = [];
  for (const file of files) {
    const reason = await queueFile(file, { taskId, uploaderId, maxBytes });
    if (reason) {
      refused.push({ name: file.name, reason });
      continue;
    }
    sendFromWorkerWhenOnline();
    void sendUploads();
  }
  return refused;
};

// Opening the app or reconnecting is the chance a backoff was waiting for, however long it had left
const sendWaitingNow = () => retryWaitingNow().catch(console.error).then(sendUploads);

// After the first paint: most opens have nothing queued, and neither can wait on the lists
const whenIdle = (run: () => void) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(run) : setTimeout(run, 0);

export const initAttachments = () => {
  whenIdle(() => {
    if (getAuthToken()) refreshAttachmentsConfig().catch(console.error);
    void sendWaitingNow();
    // Another tab's change, such as one that closed mid-upload, is this tab's to send. Its own
    // drain's changes call this too, which costs one run that finds nothing due.
    subscribeUploads(() => void sendUploads());
  });
  addEventListener("online", () => void sendWaitingNow());
  subscribeAuthToken(() => {
    if (!getAuthToken()) return;
    refreshAttachmentsConfig().catch(console.error);
    void sendUploads();
  });
};
