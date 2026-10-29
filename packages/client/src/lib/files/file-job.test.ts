import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { syncFiles } from "~/lib/files/file-job";
import { now } from "@newtab-todo/shared/iso";
import { addUpload, forgetSavedFiles, readBlob, readBlobMetas, saveBlob } from "~/lib/files/store";

const SESSION = { token: "tok", serverUrl: "https://ajot.test", userId: "me" };
const uploaded = (id: string) => ({ id, hasThumb: true, uploadedAt: "2026-10-29T00:00:00.000Z" });

beforeEach(() => {
  indexedDB.deleteDatabase("ajot-files");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/api/attachments/urls")
        return Response.json([{ id: "a1", url: "https://bucket.test/t/a1" }]);
      if (url.href === "https://bucket.test/t/a1")
        return new Response(new Blob(["thumb"], { type: "image/jpeg" }));
      return new Response(null, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

test("saves the thumbnail of each uploaded attachment it doesn't have", async () => {
  await syncFiles({ session: SESSION, rows: [uploaded("a1")] });
  expect(await readBlob("a1", "thumb")).toMatchObject({ userId: "me", pinned: false });
});

test("with a fresh list, another account's files go and the list's are stamped seen", async () => {
  await saveBlob("theirs", "file", new Blob(["x"]), "them");
  await saveBlob("a1", "thumb", new Blob(["t"]), "me");
  await syncFiles({ session: SESSION, rows: [uploaded("a1")], fetchedAt: Date.now() + 1 });
  const metas = await readBlobMetas();
  expect(metas.map((meta) => meta.key)).toEqual(["a1:thumb"]);
  expect(metas[0]?.seenAt).toBeGreaterThan(0);
});

test("without a fresh list nothing is evicted", async () => {
  await saveBlob("theirs", "file", new Blob(["x"]), "them");
  await syncFiles({ session: SESSION, rows: [] });
  expect(await readBlob("theirs", "file")).toBeDefined();
});

test("signing out forgets the account's files but not an upload still waiting", async () => {
  await saveBlob("viewed", "file", new Blob(["x"]), "me");
  await saveBlob("theirs", "file", new Blob(["x"]), "them");
  await addUpload(
    {
      row: {
        id: "waiting",
        taskId: "t1",
        name: "n.txt",
        mimeType: "text/plain",
        size: 1,
        thumbhash: null,
        hasThumb: false,
        createdAt: now(),
        updatedAt: now(),
      },
      uploaderId: "me",
      posted: false,
      serverDeleted: false,
      attempts: 0,
      retryAt: 0,
      sizeMismatches: 0,
    },
    { file: new Blob(["w"]) },
  );
  await forgetSavedFiles("me");
  const keys = (await readBlobMetas()).map((meta) => meta.key).sort();
  expect(keys).toEqual(["theirs:file", "waiting:file"]);
});
