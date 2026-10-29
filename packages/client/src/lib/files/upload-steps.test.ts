import { now } from "@newtab-todo/shared/iso";
import { describe, expect, test } from "vite-plus/test";
import type { Upload } from "~/lib/files/store";
import {
  CHANGED_WHILE_UPLOADING,
  KEEP_DELETED_MS,
  afterAnswer,
  nextStep,
} from "~/lib/files/upload-steps";

const NOW = 1_000_000;

const upload = (fields: Partial<Upload> = {}): Upload => ({
  row: {
    id: "a1",
    taskId: "t1",
    name: "photo.jpg",
    mimeType: "image/jpeg",
    size: 10,
    thumbhash: null,
    hasThumb: false,
    createdAt: now(),
    updatedAt: now(),
  },
  uploaderId: "u1",
  posted: false,
  serverDeleted: false,
  attempts: 0,
  retryAt: 0,
  sizeMismatches: 0,
  ...fields,
});

const after = (from: Upload, request: Parameters<typeof afterAnswer>[1], status: number) =>
  afterAnswer(from, request, { status, error: `answered ${status}` }, NOW).next;

describe("nextStep", () => {
  test("inserts, then uploads once the server has the row", () => {
    expect(nextStep(upload(), NOW)).toBe("insert");
    expect(nextStep(upload({ posted: true }), NOW)).toBe("upload");
  });

  test("waits out a backoff, and sends nothing for a refused one", () => {
    expect(nextStep(upload({ retryAt: NOW + 1 }), NOW)).toBeUndefined();
    expect(nextStep(upload({ failed: "Too big" }), NOW)).toBeUndefined();
  });

  test("a delete sends DELETE when the server has the row, then waits out Undo before dropping", () => {
    const deleted = upload({ posted: true, deletedAt: NOW });
    expect(nextStep(deleted, NOW)).toBe("delete");
    const sent = { ...deleted, serverDeleted: true };
    expect(nextStep(sent, NOW + KEEP_DELETED_MS - 1)).toBeUndefined();
    expect(nextStep(sent, NOW + KEEP_DELETED_MS)).toBe("drop");
    expect(nextStep(upload({ deletedAt: NOW, failed: "x" }), NOW + KEEP_DELETED_MS)).toBe("drop");
  });

  test("Undo after the DELETE went out restores it first", () => {
    expect(nextStep(upload({ posted: true, serverDeleted: true }), NOW)).toBe("restore");
  });
});

describe("afterAnswer", () => {
  test("a task the server doesn't have yet retries, remembering since when", () => {
    const next = after(upload(), "insert", 404) as Upload;
    expect(next.failed).toBeUndefined();
    expect(next.retryAt).toBeGreaterThan(NOW);
    expect(next.taskMissingSince).toBe(NOW);
    expect((after(next, "insert", 404) as Upload).taskMissingSince).toBe(NOW);
  });

  test("a route this server doesn't have (501) retries with the bytes kept, so an older server catches up", () => {
    for (const request of ["insert", "upload-url", "complete", "delete", "restore"] as const) {
      const next = after(
        upload({ posted: true, deletedAt: request === "delete" ? NOW : undefined }),
        request,
        501,
      ) as Upload;
      expect(next.failed, request).toBeUndefined();
      expect(next.serverDeleted, request).toBe(false);
      expect(next.retryAt, request).toBeGreaterThan(NOW);
    }
  });

  test("backoff grows", () => {
    const first = after(upload(), "insert", 503) as Upload;
    const second = after(first, "insert", 503) as Upload;
    expect(second.retryAt - NOW).toBeGreaterThan(first.retryAt - NOW);
  });

  test.each([403, 409, 413, 422])("a %i to the insert fails with its reason", (status) => {
    expect((after(upload(), "insert", status) as Upload).failed).toBe(`answered ${status}`);
  });

  test("deleted on the server, the attachment or its task, it's let go with its bytes", () => {
    for (const request of ["insert", "upload-url", "complete", "restore"] as const)
      expect(after(upload({ posted: true }), request, 410)).toBe("discarded");
  });

  test("an expired session holds everything", () => {
    expect(after(upload(), "insert", 401)).toBe("signed-out");
  });

  test("an attachment the purge removed is created again", () => {
    const posted = upload({ posted: true });
    expect((after(posted, "upload-url", 404) as Upload).posted).toBe(false);
    expect((after(posted, "complete", 404) as Upload).posted).toBe(false);
  });

  test("a size mismatch gets new URLs once, then fails", () => {
    const once = after(upload({ posted: true }), "complete", 400) as Upload;
    expect(once.failed).toBeUndefined();
    expect(once.sizeMismatches).toBe(1);
    expect((after(once, "complete", 400) as Upload).failed).toBe(CHANGED_WHILE_UPLOADING);
  });

  test("a failed PUT retries with new URLs", () => {
    const next = after(upload({ posted: true }), "put", 403) as Upload;
    expect(next.failed).toBeUndefined();
    expect(next.retryAt).toBeGreaterThan(NOW);
  });

  test("completing drops the entry, unless it was deleted meanwhile, which sends the DELETE", () => {
    expect(after(upload({ posted: true }), "complete", 200)).toBe("uploaded");
    const deleted = after(upload({ posted: true, deletedAt: NOW }), "complete", 200) as Upload;
    expect(nextStep(deleted, NOW)).toBe("delete");
  });

  test("a delete the server no longer has counts as done", () => {
    for (const status of [200, 404, 410])
      expect(
        (after(upload({ posted: true, deletedAt: NOW }), "delete", status) as Upload).serverDeleted,
      ).toBe(true);
  });

  test("a restore of a row the purge removed creates it again", () => {
    const next = after(upload({ posted: true, serverDeleted: true }), "restore", 404) as Upload;
    expect(next).toMatchObject({ posted: false, serverDeleted: false });
  });
});
