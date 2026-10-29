import type { Upload } from "~/lib/files/store";

/** Long enough that the Undo toast, at most 8 s, has closed. */
export const KEEP_DELETED_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
export const TASK_MISSING_HINT_MS = 24 * 60 * 60_000;
export const CHANGED_WHILE_UPLOADING = "The file changed while uploading.";

/** `upload` asks for upload URLs, sends the bytes and completes it. */
export type Step = "insert" | "upload" | "delete" | "restore" | "drop";

/** When it next has something to send or drop; undefined while it waits on the user. */
export const dueAt = (upload: Upload): number | undefined => {
  if (upload.deletedAt !== undefined)
    return upload.posted && !upload.serverDeleted
      ? upload.retryAt
      : upload.deletedAt + KEEP_DELETED_MS;
  return upload.failed === undefined ? upload.retryAt : undefined;
};

export const nextStep = (upload: Upload, now: number): Step | undefined => {
  const due = dueAt(upload);
  if (due === undefined || now < due) return undefined;
  if (upload.deletedAt !== undefined)
    return upload.posted && !upload.serverDeleted ? "delete" : "drop";
  if (upload.serverDeleted) return "restore";
  return upload.posted ? "upload" : "insert";
};

/** What came back: an HTTP status, or 0 when the request never got one. */
export type Answer = { status: number; error?: string };

/** The requests behind `upload`, each answered on its own. */
export type Request = Exclude<Step, "upload" | "drop"> | "upload-url" | "put" | "complete";

export type Outcome =
  | { next: Upload | "uploaded" }
  /** Deleted on the server, the attachment or its task, by whoever may: nothing left to send. */
  | { next: "discarded" }
  /** The session expired: nothing more is sent until someone signs in. */
  | { next: "signed-out" };

const backoff = (upload: Upload, now: number): Upload => ({
  ...upload,
  attempts: upload.attempts + 1,
  retryAt: now + Math.min(5_000 * 2 ** upload.attempts, MAX_BACKOFF_MS),
});

const ready = (upload: Upload): Upload => ({ ...upload, attempts: 0, retryAt: 0 });

const fail = (upload: Upload, reason = "The server refused it."): Upload => ({
  ...upload,
  failed: reason,
});

const isTransient = ({ status }: Answer) => status === 0 || status === 429 || status >= 500;

/**
 * What an answer does to the entry as it is now, which may have changed while the request was out:
 * a delete made meanwhile stays, and its DELETE goes next.
 */
export const afterAnswer = (
  upload: Upload,
  request: Request,
  answer: Answer,
  now: number,
): Outcome => {
  const { status } = answer;
  if (status === 401) return { next: "signed-out" };
  if (status === 410 && request !== "delete") return { next: "discarded" };
  const ok = status >= 200 && status < 300;
  switch (request) {
    case "insert":
      if (ok) return { next: { ...ready(upload), posted: true, taskMissingSince: undefined } };
      if (status === 404)
        return {
          next: { ...backoff(upload, now), taskMissingSince: upload.taskMissingSince ?? now },
        };
      break;
    case "upload-url":
      if (ok || status === 409) return { next: upload };
      // The purge removed the row, which never finished: create it again
      if (status === 404) return { next: { ...ready(upload), posted: false } };
      break;
    case "put":
      // Its URL may have expired; the next attempt asks for new ones
      if (ok) return { next: upload };
      return { next: backoff(upload, now) };
    case "complete":
      if (ok) return { next: upload.deletedAt === undefined ? "uploaded" : upload };
      if (status === 404) return { next: { ...ready(upload), posted: false } };
      // The server deleted what arrived; new URLs once, then it's the file that differs
      if (status === 400)
        return {
          next:
            upload.sizeMismatches > 0
              ? fail(upload, CHANGED_WHILE_UPLOADING)
              : { ...ready(upload), sizeMismatches: upload.sizeMismatches + 1 },
        };
      break;
    case "delete":
      if (ok || status === 404 || status === 410)
        return { next: { ...ready(upload), serverDeleted: true } };
      break;
    case "restore":
      if (ok) return { next: { ...ready(upload), serverDeleted: false } };
      if (status === 404)
        return { next: { ...ready(upload), posted: false, serverDeleted: false } };
      break;
  }
  if (isTransient(answer)) return { next: backoff(upload, now) };
  // A refusal of the user's own delete leaves nothing to do but let the entry go
  if (request === "delete") return { next: { ...upload, serverDeleted: true } };
  return { next: fail(upload, answer.error) };
};
