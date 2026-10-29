import { hc } from "hono/client";
import type { AppType } from "@newtab-todo/server/app";
import { servedType } from "@newtab-todo/shared/attachments";
import { changeUpload, readBlobs, readUploads, type Upload } from "~/lib/files/store";
import {
  afterAnswer,
  dueAt,
  nextStep,
  type Answer,
  type Request,
  type Step,
} from "~/lib/files/upload-steps";

/** serverUrl is "" for the PWA, which calls its own origin. */
export type FilesSession = { token: string; serverUrl: string; userId: string | null };

export type DrainDeps = {
  fetch: typeof fetch;
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
  fetch: (...args) => fetch(...args),
  locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : runNow,
  now: Date.now,
});

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };

const errorOf = async (res: Reply) => {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
};

const answerOf = async <R extends Reply>(request: Promise<R>): Promise<Answer & { res?: R }> => {
  try {
    const res = await request;
    return res.ok ? { status: res.status, res } : { status: res.status, error: await errorOf(res) };
  } catch {
    return { status: 0 };
  }
};

// The server's own route types, so a path or body it doesn't take fails to compile. Not the page's
// client in lib/api.ts, which reads the page's session: this runs wherever the session is handed in.
const attachmentsApi = ({ fetch }: DrainDeps, { serverUrl, token }: FilesSession) =>
  hc<AppType>(serverUrl, { fetch, headers: { Authorization: `Bearer ${token}` } }).api.attachments;

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

// The browser sends each Blob's length as content-length, which the URL signed
const put = (deps: DrainDeps, url: string, blob: Blob, contentType: string) =>
  answerOf(
    deps.fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob }),
  );

const sendBytes = async (deps: DrainDeps, session: FilesSession, upload: Upload) => {
  const { id, hasThumb, mimeType } = upload.row;
  const { file, thumb } = await readBlobs(id);
  if (!file || (hasThumb && !thumb)) {
    await changeUpload(id, (current) => ({
      ...current,
      failed: "Its file is no longer saved here.",
    }));
    return undefined;
  }
  const api = attachmentsApi(deps, session);
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

const run = async (deps: DrainDeps, session: FilesSession, upload: Upload, step: Step) => {
  const { id } = upload.row;
  const api = attachmentsApi(deps, session);
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
      return sendBytes(deps, session, upload);
  }
};

/**
 * Sends what this device holds for the signed-in account, one context at a time, until nothing
 * is due. Resolves with when the next retry is due, so the caller can come back then; undefined
 * when nothing waits on time, or the session has expired.
 */
export const drainUploads = (session: FilesSession, given: Partial<DrainDeps> = {}) => {
  const deps = { ...defaults(), ...given };
  return deps.locks.request(LOCK, async (): Promise<number | undefined> => {
    // Another account's uploads, or anyone's while the user is unknown, wait for that account
    if (!session.userId) return undefined;
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
        if ((await run(deps, session, upload, step)) === "signed-out") return undefined;
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
