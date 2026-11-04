import { nanoid } from "nanoid";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { now } from "@newtab-todo/shared/iso";
import { MAX_TEXT, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";
import { ApiError, apiClient, succeeded, type ApiClient, type SignedInSession } from "~/lib/api-client";
import { queueFile } from "~/lib/files/attach";
import { withLock } from "~/lib/locks";
import { fetchServerConfig } from "~/lib/server-config";
import {
  forgetShare,
  forgetSharedFile,
  keepShare,
  keptShareIds,
  readShare,
  setShareAdded,
  setShareTask,
  shareLockName,
  type KeptShare,
} from "~/lib/share-store";
import { taskOfKept } from "~/lib/shared-page";

export type SendStep = "sort-order" | "add" | "send" | "config" | "share" | "note" | "image";

/** Which request in a send failed, so its metric can say. */
class StepFailed extends Error {
  constructor(
    readonly step: SendStep,
    cause: unknown,
  ) {
    super(`${step} failed`, { cause });
  }
}

const step = <T>(name: SendStep, work: Promise<T>) =>
  work.catch((cause: unknown) => Promise.reject(new StepFailed(name, cause)));

/** A failure's reason as a metric name can carry it: the server's status, or the error's kind. */
export const reasonOf = (err: unknown) => {
  if (err instanceof ApiError) return String(err.status);
  const name = err instanceof Error ? err.name.toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
  return name || "unknown";
};

/** Unreachable, busy or signed out: the share is kept and sent again at the next wake. */
const isWorthRetrying = (err: unknown) =>
  !(err instanceof ApiError) || err.status === 401 || err.status === 429 || err.status >= 500;

export type FailedPart = { step: SendStep; label: string; reason: string };

export type SendOutcome =
  | { status: "sent"; title: string; failed: FailedPart[] }
  | { status: "waiting"; step: SendStep; error: unknown }
  | { status: "refused"; title: string; step: SendStep; error: unknown }
  // Gone, another account's, or an open page's to add
  | { status: "skipped" };

const nextSortOrder = async ({ api }: ApiClient) => {
  const tasks = await succeeded(api.tasks.$get()).then((res) => res.json());
  return keyAfter(tasks.flatMap((t) => (t.parentId ? [] : [t.sortOrder])));
};

type Task = { id: string; title: string; description: string | null };

const postTask = async (client: ApiClient, kept: KeptShare, task: Task) => {
  const { api } = client;
  const at = now();
  const base = { id: task.id, title: task.title, createdAt: at, updatedAt: at };
  const to = kept.to!;
  if (to.kind === "send") {
    // A note belongs to whoever wrote it, so a recipient would never see one: it goes inline
    const joined = [kept.note?.content, task.description].filter(Boolean).join("\n\n");
    const description = joined ? cutTo(joined, MAX_TEXT) : null;
    const sent = succeeded(
      api.tasks.send.$post({ json: { ...base, description, recipientId: to.recipientId } }),
    ).catch((err: unknown) => {
      // The id is this share's own, so it's taken by an earlier try that landed unanswered
      if (err instanceof ApiError && err.status === 409) return;
      throw err;
    });
    await step("send", sent);
    return;
  }
  // Both schemas require userId; the server replaces it with the token's user. A retry of an add
  // that landed gets the stored task back.
  const sortOrder = await step("sort-order", nextSortOrder(client));
  await step(
    "add",
    succeeded(
      api.tasks.$post({
        json: {
          ...base,
          userId: "",
          description: task.description,
          categoryId: to.kind === "list" ? to.categoryId : null,
          sortOrder,
          parentId: null,
          assigneeId: null,
          dueDate: null,
          editedAt: null,
          completedAt: null,
        },
      }),
    ),
  );
};

type Extra = [SendStep, string, () => Promise<unknown>];

const extrasOf = ({ api }: ApiClient, kept: KeptShare, taskId: string): Extra[] => {
  const extras: Extra[] = [];
  const { to, note } = kept;
  if (to?.kind === "share")
    extras.push([
      "share",
      "sharing",
      () => succeeded(api.tasks.share.$post({ json: { taskId, username: to.username } })),
    ]);
  if (note && to?.kind !== "send") {
    const at = now();
    extras.push([
      "note",
      "the note",
      () =>
        succeeded(
          api.notes.$post({
            json: {
              id: note.id,
              userId: "",
              taskId,
              title: cutTo(note.content, MAX_TITLE),
              content: note.content,
              createdAt: at,
              updatedAt: at,
            },
          }),
        ),
    ]);
  }
  return extras;
};

const queueFiles = async (
  session: SignedInSession,
  taskId: string,
  files: { file: File; key: [string, number] }[],
): Promise<FailedPart[]> => {
  if (files.length === 0 || !session.userId) return [];
  const { attachments } = await step("config", fetchServerConfig(session.serverUrl));
  const failed: FailedPart[] = [];
  for (const { file, key } of files) {
    const refusal = attachments
      ? await queueFile(file, { taskId, uploaderId: session.userId, maxBytes: attachments.maxBytes })
      : "no-attachments";
    if (refusal) failed.push({ step: "image", label: "the image", reason: refusal });
    await forgetSharedFile(key);
  }
  return failed;
};

const sendOnce = async (session: SignedInSession, id: string): Promise<SendOutcome> => {
  const kept = await readShare(id);
  if (!kept?.text.to || (kept.text.userId ?? null) !== session.userId) return { status: "skipped" };
  const { text } = kept;
  const shared = taskOfKept(text, kept.files.map(({ file }) => file));
  if (!shared) {
    await forgetShare(id);
    return { status: "skipped" };
  }
  const taskId = text.taskId ?? nanoid();
  if (!text.taskId) await setShareTask(id, text, taskId);
  const client = apiClient(session);
  const failed: FailedPart[] = [];
  try {
    if (!text.added) {
      await postTask(client, text, { ...shared, id: taskId });
      await setShareAdded(id, text, taskId);
    }
    for (const [extraStep, label, send] of extrasOf(client, text, taskId)) {
      try {
        await send();
      } catch (err) {
        if (isWorthRetrying(err)) throw new StepFailed(extraStep, err);
        failed.push({ step: extraStep, label, reason: reasonOf(err) });
      }
    }
    failed.push(...(await queueFiles(session, taskId, kept.files)));
  } catch (err) {
    const [failedStep, cause] = err instanceof StepFailed ? [err.step, err.cause] : ["add" as const, err];
    if (isWorthRetrying(cause)) return { status: "waiting", step: failedStep, error: cause };
    await forgetShare(id);
    return { status: "refused", title: shared.title, step: failedStep, error: cause };
  }
  await forgetShare(id);
  return { status: "sent", title: shared.title, failed };
};

/**
 * Sends a share the menu kept to the server: its task, then what goes with it, then forgets it.
 * Under the share's lock, so a page adding it locally and this can't both add it.
 */
export const sendKeptShare = (session: SignedInSession, id: string) =>
  withLock(shareLockName(id), () => sendOnce(session, id));

/**
 * Keeps a share and sends it, under one hold of its lock, so a background's sweep starting
 * meanwhile can't send it first and leave the click nothing to say. Rejects only if it can't be
 * kept.
 */
export const keepAndSend = (
  session: SignedInSession,
  id: string,
  kept: KeptShare,
  files: File[],
) =>
  withLock(shareLockName(id), async () => {
    await keepShare(id, kept, files);
    return sendOnce(session, id).catch(
      (error: unknown): SendOutcome => ({ status: "waiting", step: "add", error }),
    );
  });

/** Sends every share the menu kept that's still waiting; returns what each did. */
export const sendKeptShares = async (session: SignedInSession) => {
  const outcomes: { id: string; outcome: SendOutcome }[] = [];
  for (const id of await keptShareIds()) {
    const outcome = await sendKeptShare(session, id).catch(
      (error: unknown): SendOutcome => ({ status: "waiting", step: "add", error }),
    );
    outcomes.push({ id, outcome });
    // Unreachable for one, unreachable for the rest
    if (outcome.status === "waiting" && !(outcome.error instanceof ApiError)) break;
  }
  return outcomes;
};
