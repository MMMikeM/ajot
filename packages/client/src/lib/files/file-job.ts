import { apiClient, succeeded, type SignedInSession } from "~/lib/api-client";
import { getFromBucket } from "~/lib/files/bucket";
import { planEviction } from "~/lib/files/evict-plan";
import { deleteBlobs, markSeen, readBlobMetas, saveBlob } from "~/lib/files/store";
import { withLock } from "~/lib/locks";

const LOCK = "ajot-files";
const MB = 1024 * 1024;
const MAX_BUDGET_BYTES = 100 * MB;
// What one run may download, so a push's worker finishes inside its time
const MAX_THUMBS_PER_RUN = 200;
const URLS_PER_REQUEST = 100;

type Row = { id: string; hasThumb: boolean; uploadedAt: string | null };

/** What a run works from: the attachments a list showed, and whether it came fresh from the server. */
export type FilesRun = {
  session: SignedInSession;
  rows: Row[];
  /** When the list was fetched, given only for a 200; without it nothing is evicted. */
  fetchedAt?: number;
};

const isRow = (row: unknown): row is Row =>
  typeof row === "object" && row !== null && typeof (row as Row).id === "string";

/** The rows of a saved or fetched attachments list, whatever shape it arrived in. */
export const rowsOf = (list: unknown): Row[] => (Array.isArray(list) ? list.filter(isRow) : []);

// Full files share 100 MB, or 5% of what the browser lets this origin keep when that's less
const budgetBytes = async () => {
  try {
    const { quota } = await navigator.storage.estimate();
    return quota ? Math.min(MAX_BUDGET_BYTES, quota * 0.05) : MAX_BUDGET_BYTES;
  } catch {
    return MAX_BUDGET_BYTES;
  }
};

const saveThumbnails = async ({ session, rows }: FilesRun, saved: ReadonlySet<string>) => {
  if (!session.userId) return;
  const missing = rows
    .filter((row) => row.uploadedAt && row.hasThumb && !saved.has(`${row.id}:thumb`))
    .slice(0, MAX_THUMBS_PER_RUN);
  const { api } = apiClient(session);
  for (let at = 0; at < missing.length; at += URLS_PER_REQUEST) {
    const ids = missing.slice(at, at + URLS_PER_REQUEST).map((row) => row.id);
    const urls = await succeeded(api.attachments.urls.$post({ json: { ids, variant: "thumb" } }))
      .then((res) => res.json())
      .catch((err) => {
        console.error("[files] couldn't get thumbnail URLs:", err);
        return [];
      });
    for (const { id, url } of urls) {
      try {
        const res = await getFromBucket(url);
        if (res.ok) await saveBlob(id, "thumb", await res.blob(), session.userId);
      } catch (err) {
        console.error("[files] couldn't save a thumbnail:", err);
      }
    }
  }
};

const runOnce = async (run: FilesRun) => {
  const now = Date.now();
  const ids = new Set(run.rows.map((row) => row.id));
  if (run.fetchedAt !== undefined) await markSeen(ids, now);
  const before = await readBlobMetas();
  await saveThumbnails(run, new Set(before.map((blob) => blob.key)));
  if (run.fetchedAt === undefined || !run.session.userId) return;
  const evict = planEviction({
    blobs: await readBlobMetas(),
    list: { userId: run.session.userId, ids, fetchedAt: run.fetchedAt },
    now,
    budgetBytes: await budgetBytes(),
  });
  if (evict.size > 0) await deleteBlobs(evict);
};

/**
 * Keeps what this device holds in step with a list of attachments: every thumbnail saved for a
 * page opened offline, and with a list fresh from the server, what it no longer needs deleted.
 * One context at a time. Never rejects: a failure here must not stop the sync around it.
 */
export const syncFiles = (run: FilesRun) => {
  return withLock(LOCK, () => runOnce(run).catch((err) => console.error("[files]", err)));
};
