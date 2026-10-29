import { servedType } from "@newtab-todo/shared/attachments";
import {
  apiClient,
  errorOf,
  type ApiClient,
  type Fetcher,
  type Reply,
  type SignedInSession,
} from "~/lib/api-client";
import { putToBucket } from "~/lib/files/bucket";
import { changeUpload, readBlobs, readUploads, type Upload } from "~/lib/files/store";
import {
  afterAnswer,
  dueAt,
  nextStep,
  type Answer,
  type Request,
  type Step,
} from "~/lib/files/upload-steps";

export type DrainDeps = {
  /** The global one when left out. */
  fetch?: Fetcher;
  locks: { request: <T>(name: string, run: () => Promise<T>) => Promise<T> };
  now: () => number;
  /** The row `/complete` answered with, for a page to show before its broadcast arrives. */
  onUploaded?: (row: unknown) => void;
};

const LOCK = "ajot-uploads";
// Every request changes the entry it was for, so a run settles; this only bounds a bug
const MAX_ROUNDS = 50;

// Without Web Locks (an http origin, an old Safari) two contexts may send the same request, which
// the server answers alike
const runNow: DrainDeps["locks"] = { request: (_name, run) => run() };

const defaults = (): DrainDeps => ({
  locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : runNow,
  now: Date.now,
});

const answerOf = async <R extends Reply>(request: Promise<R>): Promise<Answer & { res?: R }> => {
  try {
    const res = await request;
    return res.ok ? { status: res.status, res } : { status: res.status, error: await errorOf(res) };
  } catch {
    return { status: 0 };
  }
};

type AttachmentsApi = ApiClient["api"]["attachments"];

/** Applies the answer to the entry as it is now; undefined when the entry is gone. */
const settle = async (deps: DrainDeps, id: string, request: Request, answer: Answer) => {
  let outcome: ReturnType<typeof afterAnswer> | undefined;
  await changeUpload(id, (current) => {
    outcome = afterAnswer(current, request, answer, deps.now());
    return outcome.next === "signed-out" ? undefined : outcome.next;
  });
  return outcome?.next;
};

/** Whether the upload goes on after a request: not deleted, refused or put off meanwhile. */
const goesOn = (next: Awaited<ReturnType<typeof settle>>, deps: DrainDeps): next is Upload =>
  typeof next === "object" &&
  next.deletedAt === undefined &&
  next.failed === undefined &&
  next.posted &&
  next.retryAt <= deps.now();

const put = (deps: DrainDeps, url: string, blob: Blob, contentType: string) =>
  answerOf(putToBucket(url, blob, contentType, deps.fetch));

const sendBytes = async (deps: DrainDeps, api: AttachmentsApi, upload: Upload) => {
  const { id, hasThumb, mimeType } = upload.row;
  const { file, thumb } = await readBlobs(id);
  if (!file || (hasThumb && !thumb)) {
    await changeUpload(id, (current) => ({
      ...current,
      failed: "Its file is no longer saved here.",
    }));
    return undefined;
  }
  const urls = await answerOf(
    api["upload-url"].$post({ json: { id, ...(hasThumb && { thumbSize: thumb!.blob.size }) } }),
  );
  let next = await settle(deps, id, "upload-url", urls);
  if (!goesOn(next, deps)) return next;
  // 409: already uploaded, and /complete answers again
  if (urls.res?.status === 200) {
    const { file: fileUrl, thumb: thumbUrl } = await urls.res.json();
    if (thumbUrl && thumb) {
      next = await settle(deps, id, "put", await put(deps, thumbUrl, thumb.blob, "image/jpeg"));
      if (!goesOn(next, deps)) return next;
    }
    next = await settle(deps, id, "put", await put(deps, fileUrl, file.blob, servedType(mimeType)));
    if (!goesOn(next, deps)) return next;
  }
  const completed = await answerOf(api.complete.$post({ json: { id } }));
  next = await settle(deps, id, "complete", completed);
  if (next === "uploaded" && completed.res?.status === 200)
    deps.onUploaded?.(await completed.res.json());
  return next;
};

const run = async (deps: DrainDeps, api: AttachmentsApi, upload: Upload, step: Step) => {
  const { id } = upload.row;
  switch (step) {
    case "drop":
      await changeUpload(id, (current) =>
        current.deletedAt === undefined ? undefined : "discarded",
      );
      return undefined;
    case "insert":
      return settle(deps, id, "insert", await answerOf(api.$post({ json: upload.row })));
    case "delete":
      return settle(deps, id, "delete", await answerOf(api.$delete({ json: { id } })));
    case "restore":
      return settle(deps, id, "restore", await answerOf(api.$put({ json: { id } })));
    case "upload":
      return sendBytes(deps, api, upload);
  }
};

/**
 * Sends what this device holds for the signed-in account, one context at a time, until nothing
 * is due. Resolves with when the next retry is due, so the caller can come back then; undefined
 * when nothing waits on time, or the session has expired.
 */
export const drainUploads = (session: SignedInSession, given: Partial<DrainDeps> = {}) => {
  const deps = { ...defaults(), ...given };
  return deps.locks.request(LOCK, async (): Promise<number | undefined> => {
    // Another account's uploads, or anyone's while the user is unknown, wait for that account
    if (!session.userId) return undefined;
    const api = apiClient(session, { fetch: deps.fetch }).api.attachments;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const uploads = (await readUploads()).filter((u) => u.uploaderId === session.userId);
      const now = deps.now();
      const due = uploads.flatMap((upload) => {
        const step = nextStep(upload, now);
        return step ? [{ upload, step }] : [];
      });
      if (due.length === 0) {
        const times = uploads.flatMap((upload) => dueAt(upload) ?? []);
        return times.length > 0 ? Math.min(...times) : undefined;
      }
      for (const { upload, step } of due)
        if ((await run(deps, api, upload, step)) === "signed-out") return undefined;
    }
    return undefined;
  });
};

/** Kept until Undo can't bring it back; a DELETE goes first if the server has its row. */
export const deleteUpload = (id: string, now = Date.now()) =>
  changeUpload(id, (upload) => ({ ...upload, deletedAt: now, attempts: 0, retryAt: 0 }));

export const undoDeleteUpload = (id: string) =>
  changeUpload(id, (upload) =>
    upload.deletedAt === undefined ? undefined : { ...upload, deletedAt: undefined, retryAt: 0 },
  );

export const retryUpload = (id: string) =>
  changeUpload(id, (upload) => ({
    ...upload,
    failed: undefined,
    attempts: 0,
    retryAt: 0,
    sizeMismatches: 0,
  }));
