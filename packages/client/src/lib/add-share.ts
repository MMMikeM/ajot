import { nanoid } from "nanoid";
import { getAttachmentsConfig, refreshAttachmentsConfig } from "~/lib/attachments/config";
import { tellRefused } from "~/lib/attachments/attach-and-tell";
import { attachFiles } from "~/lib/attachments/queue";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getBuildTarget } from "~/lib/build-target";
import { addTask } from "~/lib/db/add-task";
import { notesCollection, tasksCollection } from "~/lib/db/collections";
import { addNote } from "~/lib/db/hooks";
import { getCurrentUserId, getSignedInUserId } from "~/lib/auth/current-user";
import { withLock } from "~/lib/locks";
import {
  forgetShare,
  forgetSharedFile,
  keptShareIds,
  onKeptShare,
  readShare,
  setShareAdded,
  setShareTask,
  shareLockName,
  type KeptShare,
} from "~/lib/share-store";
import { shareIdIn, taskOfKept } from "~/lib/shared-page";
import { whenIdle } from "~/lib/when-idle";

// The server's limit, asked for if this device hasn't heard it; offline, the server refuses what's
// too big when the upload asks
const maxBytes = async () => {
  if (!getAttachmentsConfig() && getAuthToken())
    await refreshAttachmentsConfig().catch(console.error);
  return getAttachmentsConfig()?.maxBytes ?? Number.POSITIVE_INFINITY;
};

/** Only the extension's background can share or send a task, and only for the account that asked. */
const isThisPagesToAdd = ({ to, userId }: KeptShare) =>
  to?.kind !== "share" && to?.kind !== "send" && (!userId || userId === getSignedInUserId());

const addOnce = async (id: string) => {
  const kept = await readShare(id);
  if (!kept || !isThisPagesToAdd(kept.text)) return undefined;
  const task = taskOfKept(
    kept.text,
    kept.files.map(({ file }) => file),
  );
  if (!task) {
    await forgetShare(id);
    return undefined;
  }
  const { to, note } = kept.text;
  const taskId = kept.text.taskId ?? nanoid();
  if (!kept.text.taskId) await setShareTask(id, kept.text, taskId);
  await tasksCollection.stateWhenReady();
  if (!kept.text.added && !tasksCollection.has(taskId)) {
    const categoryId = to?.kind === "list" ? to.categoryId : null;
    await addTask(task.title, categoryId, null, task.description, taskId);
    await setShareAdded(id, kept.text, taskId);
  }
  if (note) {
    await notesCollection.stateWhenReady();
    if (!notesCollection.has(note.id))
      addNote({ userId: getCurrentUserId(), taskId, content: note.content }, note.id);
  }

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
export const addShare = (id: string) => withLock(shareLockName(id), () => addOnce(id));

// The share page adds its own share, and must find it there to open its task
const ownShare = () => shareIdIn(location, getBuildTarget() === "extension");

const addLeftoverShares = async () => {
  for (const id of await keptShareIds())
    if (id !== ownShare()) await addShare(id).catch(console.error);
};

/**
 * Finishes any share a page closed before adding, or that waited for a sign-in, and adds what the
 * extension's menu saved while the server couldn't be reached.
 */
export const initShares = () => {
  if (getBuildTarget() === "server") return;
  whenIdle(() => void addLeftoverShares().catch(console.error));
  onKeptShare(() => void addLeftoverShares().catch(console.error));
  subscribeAuthToken(() => {
    if (getAuthToken()) void addLeftoverShares().catch(console.error);
  });
};
