import { nanoid } from "nanoid";
import { getAttachmentsConfig, refreshAttachmentsConfig } from "~/lib/attachments/config";
import { tellRefused } from "~/lib/attachments/attach-and-tell";
import { attachFiles } from "~/lib/attachments/queue";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getBuildTarget } from "~/lib/build-target";
import { addTask } from "~/lib/db/add-task";
import { tasksCollection } from "~/lib/db/collections";
import { withLock } from "~/lib/locks";
import {
  forgetShare,
  forgetSharedFile,
  keptShareIds,
  readShare,
  setShareTask,
} from "~/lib/share-store";
import { taskFromShare } from "~/lib/shared-page";
import { whenIdle } from "~/lib/when-idle";

// The server's limit, asked for if this device hasn't heard it; offline, the server refuses what's
// too big when the upload asks
const maxBytes = async () => {
  if (!getAttachmentsConfig() && getAuthToken())
    await refreshAttachmentsConfig().catch(console.error);
  return getAttachmentsConfig()?.maxBytes ?? Number.POSITIVE_INFINITY;
};

const addOnce = async (id: string) => {
  const kept = await readShare(id);
  if (!kept) return undefined;
  const task = taskFromShare({ ...kept.text, files: kept.files.map(({ file }) => file) });
  if (!task) {
    await forgetShare(id);
    return undefined;
  }
  const taskId = kept.text.taskId ?? nanoid();
  if (!kept.text.taskId) await setShareTask(id, kept.text, taskId);
  await tasksCollection.stateWhenReady();
  if (!tasksCollection.has(taskId)) await addTask(task.title, null, null, task.description, taskId);

  const limit = kept.files.length > 0 ? await maxBytes() : 0;
  for (const { file, key } of kept.files) {
    const [refused] = await attachFiles(taskId, [file], limit);
    // The rest wait here for a sign-in, which finishes them
    if (refused?.reason === "signed-out") return { taskId, waitingForSignIn: true };
    if (refused) tellRefused(refused, limit);
    await forgetSharedFile(key);
  }
  await forgetShare(id);
  return { taskId, waitingForSignIn: false };
};

/**
 * Adds a share the worker kept: its task in the Inbox, then its files, then forgets it. One page
 * at a time, so two can't add it twice; a page closed partway through leaves the rest for the next.
 */
export const addShare = (id: string) => withLock(`ajot-share-${id}`, () => addOnce(id));

// The share page adds its own share, and must find it there to open its task
const ownShare = () =>
  location.pathname === "/share" ? new URLSearchParams(location.search).get("id") : null;

const addLeftoverShares = async () => {
  for (const id of await keptShareIds())
    if (id !== ownShare()) await addShare(id).catch(console.error);
};

/** Finishes any share a page closed before adding, or that waited for a sign-in. */
export const initShares = () => {
  if (getBuildTarget() !== "browser") return;
  whenIdle(() => void addLeftoverShares().catch(console.error));
  subscribeAuthToken(() => {
    if (getAuthToken()) void addLeftoverShares().catch(console.error);
  });
};
