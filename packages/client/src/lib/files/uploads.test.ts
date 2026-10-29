import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { addUpload, readBlob, readUploads, type Upload } from "~/lib/files/store";
import { deleteUpload, drainUploads, undoDeleteUpload, type DrainDeps } from "~/lib/files/uploads";

const SESSION = { token: "tok", serverUrl: "https://ajot.test", userId: "u1" };

const entry = (id: string, fields: Partial<Upload> = {}): Upload => ({
  row: {
    id,
    taskId: "t1",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size: 3,
    thumbhash: null,
    hasThumb: true,
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  },
  uploaderId: "u1",
  posted: false,
  serverDeleted: false,
  attempts: 0,
  retryAt: 0,
  sizeMismatches: 0,
  ...fields,
});

type Handler = (body: unknown, init: RequestInit) => Response | Promise<Response>;

/** Answers each `METHOD path` with its handler, recording every request. */
const server = (handlers: Record<string, Handler>) => {
  const sent: string[] = [];
  const fetch: DrainDeps["fetch"] = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init.method} ${url.origin === SESSION.serverUrl ? url.pathname : url.href}`;
    sent.push(key);
    const handler = handlers[key];
    if (!handler) return Response.json({ error: `no handler for ${key}` }, { status: 500 });
    return handler(typeof init.body === "string" ? JSON.parse(init.body) : init.body, init);
  };
  return { sent, fetch };
};

let now = 1_000_000;
const deps = (fetch: DrainDeps["fetch"]): DrainDeps => ({
  fetch,
  locks: { request: (async (_name: string, run: () => unknown) => run()) as never },
  now: () => now,
});

const happyPath = (seen: Record<string, unknown> = {}): Record<string, Handler> => ({
  "POST /api/attachments/": (body) => Response.json(body),
  "POST /api/attachments/upload-url": (body) => {
    seen.uploadUrl = body;
    return Response.json({ file: "https://bucket.test/file", thumb: "https://bucket.test/thumb" });
  },
  "PUT https://bucket.test/thumb": (body, init) => {
    seen.thumbType = new Headers(init.headers).get("content-type");
    return new Response(null, { status: 200 });
  },
  "PUT https://bucket.test/file": (_body, init) => {
    seen.fileType = new Headers(init.headers).get("content-type");
    return new Response(null, { status: 200 });
  },
  "POST /api/attachments/complete": () => Response.json({ id: "a1", uploadedAt: "now" }),
});

beforeEach(() => {
  indexedDB.deleteDatabase("ajot-files");
  now = 1_000_000;
});

describe("drainUploads", () => {
  test("an attachment deleted on the server meanwhile is let go, bytes and all", async () => {
    await addUpload(entry("a1", { posted: true }), {
      file: new Blob(["abc"]),
      thumb: new Blob(["tt"]),
    });
    const { fetch } = server({
      ...happyPath(),
      "POST /api/attachments/upload-url": () =>
        Response.json({ error: "That file was deleted." }, { status: 410 }),
    });
    await drainUploads(SESSION, deps(fetch));
    expect(await readUploads()).toEqual([]);
    expect(await readBlob("a1", "file")).toBeUndefined();
  });

  test("inserts, sends the thumbnail then the file, completes, and keeps the bytes as a cache", async () => {
    await addUpload(entry("a1"), { file: new Blob(["abc"]), thumb: new Blob(["tt"]) });
    const seen: Record<string, unknown> = {};
    const { sent, fetch } = server(happyPath(seen));
    const uploaded: unknown[] = [];
    expect(
      await drainUploads(SESSION, { ...deps(fetch), onUploaded: (row) => uploaded.push(row) }),
    ).toBeUndefined();
    expect(uploaded).toEqual([{ id: "a1", uploadedAt: "now" }]);
    expect(sent).toEqual([
      "POST /api/attachments/",
      "POST /api/attachments/upload-url",
      "PUT https://bucket.test/thumb",
      "PUT https://bucket.test/file",
      "POST /api/attachments/complete",
    ]);
    expect(seen).toEqual({
      uploadUrl: { id: "a1", thumbSize: 2 },
      thumbType: "image/jpeg",
      fileType: "image/jpeg",
    });
    expect(await readUploads()).toEqual([]);
    expect(await readBlob("a1", "file")).toMatchObject({ pinned: false });
  });

  test("a file off the open-in-tab list is sent as octet-stream", async () => {
    const upload = entry("a1");
    upload.row = { ...upload.row, mimeType: "text/html", hasThumb: false };
    await addUpload(upload, { file: new Blob(["abc"]) });
    const seen: Record<string, unknown> = {};
    await drainUploads(SESSION, deps(server(happyPath(seen)).fetch));
    expect(seen.fileType).toBe("application/octet-stream");
    expect(seen.uploadUrl).toEqual({ id: "a1" });
  });

  test("another account's uploads wait for it", async () => {
    await addUpload(entry("a1", { uploaderId: "u2" }), { file: new Blob(["abc"]) });
    const { sent, fetch } = server(happyPath());
    await drainUploads(SESSION, deps(fetch));
    await drainUploads({ ...SESSION, userId: null }, deps(fetch));
    expect(sent).toEqual([]);
  });

  test("a task not synced yet waits, and says when to come back", async () => {
    await addUpload(entry("a1"), { file: new Blob(["abc"]), thumb: new Blob(["tt"]) });
    const { sent, fetch } = server({
      ...happyPath(),
      "POST /api/attachments/": () => Response.json({ error: "No task" }, { status: 404 }),
    });
    const retryAt = await drainUploads(SESSION, deps(fetch));
    expect(sent).toEqual(["POST /api/attachments/"]);
    expect(retryAt).toBeGreaterThan(now);
    expect((await readUploads())[0]).toMatchObject({ posted: false, taskMissingSince: now });
  });

  test("a refusal keeps the bytes and stops", async () => {
    await addUpload(entry("a1"), { file: new Blob(["abc"]), thumb: new Blob(["tt"]) });
    const { fetch } = server({
      ...happyPath(),
      "POST /api/attachments/": () =>
        Response.json({ error: "That's over your 2048 MB of files." }, { status: 413 }),
    });
    expect(await drainUploads(SESSION, deps(fetch))).toBeUndefined();
    expect((await readUploads())[0]?.failed).toBe("That's over your 2048 MB of files.");
    expect(await readBlob("a1", "file")).toMatchObject({ pinned: true });
  });

  test("a network failure mid-upload retries later, from new URLs", async () => {
    await addUpload(entry("a1", { posted: true }), {
      file: new Blob(["abc"]),
      thumb: new Blob(["tt"]),
    });
    const { sent, fetch } = server({
      ...happyPath(),
      "PUT https://bucket.test/file": () => Promise.reject(new TypeError("offline")),
    });
    await drainUploads(SESSION, deps(fetch));
    expect(sent.at(-1)).toBe("PUT https://bucket.test/file");
    expect((await readUploads())[0]).toMatchObject({ posted: true, attempts: 1 });
  });

  test("deleted before it was sent: nothing goes, and it's dropped once Undo is over", async () => {
    await addUpload(entry("a1"), { file: new Blob(["abc"]) });
    await deleteUpload("a1", now);
    const { sent, fetch } = server(happyPath());
    expect(await drainUploads(SESSION, deps(fetch))).toBeGreaterThan(now);
    now += 60_000;
    await drainUploads(SESSION, deps(fetch));
    expect(sent).toEqual([]);
    expect(await readUploads()).toEqual([]);
    expect(await readBlob("a1", "file")).toBeUndefined();
  });

  test("deleted after it was sent: DELETE, then Undo restores it before finishing", async () => {
    await addUpload(entry("a1", { posted: true }), {
      file: new Blob(["abc"]),
      thumb: new Blob(["tt"]),
    });
    await deleteUpload("a1", now);
    const { sent, fetch } = server({
      ...happyPath(),
      "DELETE /api/attachments/": () => Response.json({}),
      "PUT /api/attachments/": () => Response.json({}),
    });
    await drainUploads(SESSION, deps(fetch));
    expect(sent).toEqual(["DELETE /api/attachments/"]);
    await undoDeleteUpload("a1");
    await drainUploads(SESSION, deps(fetch));
    expect(sent).toEqual([
      "DELETE /api/attachments/",
      "PUT /api/attachments/",
      "POST /api/attachments/upload-url",
      "PUT https://bucket.test/thumb",
      "PUT https://bucket.test/file",
      "POST /api/attachments/complete",
    ]);
    expect(await readUploads()).toEqual([]);
  });
});
