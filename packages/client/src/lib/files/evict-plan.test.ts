import { describe, expect, test } from "vite-plus/test";
import type { BlobMeta } from "~/lib/files/store";
import { KEEP_UNSEEN_MS, planEviction, type FreshList } from "~/lib/files/evict-plan";

const NOW = 10 * KEEP_UNSEEN_MS;
const FETCHED = NOW - 1_000;
const MB = 1024 * 1024;

const blob = (id: string, fields: Partial<BlobMeta> = {}): BlobMeta => ({
  key: `${id}:${fields.variant ?? "file"}`,
  id,
  variant: "file",
  userId: "me",
  pinned: false,
  savedAt: FETCHED - 5_000,
  size: MB,
  ...fields,
});

const list = (ids: string[], fields: Partial<FreshList> = {}): FreshList => ({
  userId: "me",
  ids: new Set(ids),
  fetchedAt: FETCHED,
  ...fields,
});

const plan = (blobs: BlobMeta[], fresh: FreshList | undefined, budgetBytes = 100 * MB) =>
  [...planEviction({ blobs, list: fresh, now: NOW, budgetBytes })].sort();

describe("planEviction", () => {
  test("without a fresh list (a failed fetch, a 401's empty answer, no known user) nothing goes", () => {
    const gone = blob("gone", { seenAt: 0 });
    const other = blob("theirs", { userId: "them" });
    expect(plan([gone, other], undefined)).toEqual([]);
  });

  test("another account's blobs go, unless pinned", () => {
    const theirs = blob("theirs", { userId: "them" });
    const theirUpload = blob("waiting", { userId: "them", pinned: true });
    expect(plan([theirs, theirUpload], list([]))).toEqual(["theirs:file"]);
  });

  test("a blob missing from the list goes only once it's been unseen for a day, for an Undo", () => {
    const recent = blob("deleted-today", { seenAt: NOW - KEEP_UNSEEN_MS + 60_000 });
    const old = blob("deleted-last-week", { seenAt: NOW - 7 * KEEP_UNSEEN_MS });
    const listed = blob("listed", { seenAt: 0 });
    expect(plan([recent, old, listed], list(["listed"]))).toEqual(["deleted-last-week:file"]);
  });

  test("never one saved after the list was fetched, nor a pinned upload", () => {
    const justSaved = blob("just-uploaded", { savedAt: FETCHED + 1, seenAt: 0 });
    const pinned = blob("waiting", { pinned: true, seenAt: 0 });
    expect(plan([justSaved, pinned], list([]))).toEqual([]);
  });

  test("over the budget, the least recently used full files go first; thumbnails stay", () => {
    const old = blob("old", { usedAt: 1, size: 60 * MB });
    const recent = blob("recent", { usedAt: 5, size: 60 * MB });
    const thumb = blob("old", { variant: "thumb", usedAt: 0, size: 60 * MB });
    expect(plan([old, recent, thumb], list(["old", "recent"]))).toEqual(["old:file"]);
  });

  test("files already going count off the budget", () => {
    const theirs = blob("theirs", { userId: "them", size: 90 * MB });
    const mine = blob("mine", { size: 20 * MB });
    expect(plan([theirs, mine], list(["mine"]))).toEqual(["theirs:file"]);
  });
});
