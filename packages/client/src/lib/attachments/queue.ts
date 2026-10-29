import { nanoid } from "nanoid";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getSignedInUserId } from "~/lib/auth/current-user";
import { getServerUrl } from "~/lib/server-url";
import { attachmentsCollection } from "~/lib/db/collections";
import { addUpload, retryWaitingNow, subscribeUploads } from "~/lib/files/store";
import { prepareFile } from "~/lib/files/prepare";
import { drainUploads } from "~/lib/files/uploads";
import { refreshAttachmentsConfig } from "~/lib/attachments/config";
import type { Attachment } from "~/lib/types";
import { now } from "~/lib/utils";

let running = false;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

// The uploader's page shows it uploaded at once, rather than when its broadcast comes back
const showUploaded = (row: unknown) =>
  void attachmentsCollection.utils.writeUpsert(row as Attachment).catch(console.error);

/** Sends what's waiting; a call during a run makes it run again once it's done. */
export const sendUploads = async () => {
  const token = getAuthToken();
  if (!token) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(retryTimer);
  try {
    do {
      again = false;
      const retryAt = await drainUploads(
        { token, serverUrl: getServerUrl(), userId: getSignedInUserId() },
        { onUploaded: showUploaded },
      );
      if (retryAt !== undefined)
        retryTimer = setTimeout(() => void sendUploads(), Math.max(0, retryAt - Date.now()));
    } while (again);
  } catch (err) {
    console.error("[uploads]", err);
  } finally {
    running = false;
  }
};

export type Refused = { name: string; reason: "empty" | "too-big" | "not-saved" };

/**
 * Saves each file on this device and queues it, so it shows at once and survives the tab closing.
 * Resolves with the files it couldn't add.
 */
export const attachFiles = async (taskId: string, files: File[], maxBytes: number) => {
  const uploaderId = getSignedInUserId();
  if (!uploaderId) return [];
  // What a transparent image's thumbnail is drawn over: the page's colour, which is on <html>
  const background = getComputedStyle(document.documentElement).backgroundColor;
  const refused: Refused[] = [];
  for (const chosen of files) {
    if (chosen.size === 0) {
      refused.push({ name: chosen.name, reason: "empty" });
      continue;
    }
    const prepared = await prepareFile(chosen, background);
    if (prepared.file.size > maxBytes) {
      refused.push({ name: chosen.name, reason: "too-big" });
      continue;
    }
    const at = now();
    try {
      await addUpload(
        {
          row: {
            id: nanoid(),
            taskId,
            name: prepared.name,
            mimeType: prepared.mimeType,
            size: prepared.file.size,
            thumbhash: null,
            hasThumb: !!prepared.thumb,
            createdAt: at,
            updatedAt: at,
          },
          uploaderId,
          posted: false,
          serverDeleted: false,
          attempts: 0,
          retryAt: 0,
          sizeMismatches: 0,
        },
        { file: prepared.file, ...(prepared.thumb && { thumb: prepared.thumb }) },
      );
    } catch (err) {
      console.error("[uploads] couldn't save", err);
      refused.push({ name: chosen.name, reason: "not-saved" });
      continue;
    }
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
