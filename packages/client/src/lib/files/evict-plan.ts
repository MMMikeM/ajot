import type { BlobMeta } from "~/lib/files/store";

/** Long enough that a deleted task's files are still here for its Undo. */
export const KEEP_UNSEEN_MS = 24 * 60 * 60_000;

/** A list of the attachments this account can see, as the server answered it with a 200. */
export type FreshList = { userId: string; ids: ReadonlySet<string>; fetchedAt: number };

/**
 * Which saved blobs to delete. Only with a list fresh from the server for a known account: a
 * failed fetch, a signed-out session or another account's answer says nothing about what's gone.
 * Never a pinned blob, whose upload may exist nowhere else, nor one saved after the list was
 * fetched, which the list couldn't have known about. Then: another account's blobs, those missing
 * from the lists for over a day, and full files beyond the budget, least recently used first.
 */
export const planEviction = ({
  blobs,
  list,
  now,
  budgetBytes,
}: {
  blobs: BlobMeta[];
  list: FreshList | undefined;
  now: number;
  budgetBytes: number;
}): Set<string> => {
  const evict = new Set<string>();
  if (!list) return evict;
  const candidates = blobs.filter((blob) => !blob.pinned && blob.savedAt < list.fetchedAt);
  for (const blob of candidates) {
    if (blob.userId !== list.userId) evict.add(blob.key);
    else if (!list.ids.has(blob.id) && now - (blob.seenAt ?? blob.savedAt) > KEEP_UNSEEN_MS)
      evict.add(blob.key);
  }

  // Thumbnails are all kept, being small; full files share the budget
  const files = blobs.filter((blob) => blob.variant === "file" && !evict.has(blob.key));
  let total = files.reduce((sum, blob) => sum + blob.size, 0);
  const oldestFirst = files
    .filter((blob) => candidates.includes(blob))
    .sort((a, b) => (a.usedAt ?? a.savedAt) - (b.usedAt ?? b.savedAt));
  for (const blob of oldestFirst) {
    if (total <= budgetBytes) break;
    evict.add(blob.key);
    total -= blob.size;
  }
  return evict;
};
