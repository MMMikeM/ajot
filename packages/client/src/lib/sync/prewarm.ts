import type { PushRows } from "@newtab-todo/shared/push-payload";
import {
  SNAPSHOT_KEYS,
  openSnapshotDb,
  readSnapshot,
  saveSnapshot,
  writeSnapshot,
} from "~/lib/snapshot-store";
import { applyRows } from "~/lib/sync/saved-rows";

/** serverUrl is "" for the PWA, which calls its own origin. userId is null until it's known. */
export type PrewarmSession = { token: string; serverUrl: string; userId: string | null };

type GetSession = () => Promise<PrewarmSession | null>;

const fetchList = async ({ serverUrl, token }: PrewarmSession, key: string) => {
  const res = await fetch(`${serverUrl}/api/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`/api/${key} answered ${res.status}`);
  return [key, (await res.json()) as unknown] as const;
};

const sameSession = (a: PrewarmSession | null, b: PrewarmSession) =>
  a?.token === b.token && a.serverUrl === b.serverUrl;

// Rows from another account (a device signed out while offline, still subscribed) never land
const saveRows = async (getSession: GetSession, rows: PushRows) => {
  const session = await getSession();
  if (!session || session.userId !== rows.userId) return;
  const db = await openSnapshotDb();
  try {
    const models = [...new Set(rows.events.map((event) => event.model))];
    await writeSnapshot(db, applyRows(await readSnapshot(db, models), rows.events));
  } finally {
    db.close();
  }
};

const prewarmOnce = async (getSession: GetSession) => {
  const session = await getSession();
  if (!session) return;
  const results = await Promise.allSettled(SNAPSHOT_KEYS.map((key) => fetchList(session, key)));
  // Signed out or into another account meanwhile: the next tab must not open on these lists
  if (!sameSession(await getSession(), session)) return;
  const lists = results.flatMap((result) => {
    if (result.status === "fulfilled") return [result.value];
    console.error("[prewarm]", result.reason);
    return [];
  });
  if (lists.length > 0) await saveSnapshot(lists);
};

/**
 * Saves the server's lists where a page reads them on startup, so one opened offline shows what
 * the server last had. A push's rows are saved first, so they're kept if the fetch then fails.
 * The returned function never rejects; calls run one at a time, so an earlier fetch can never
 * save over a later one.
 */
export const createPrewarm = (getSession: GetSession) => {
  let queue = Promise.resolve();
  return (rows?: PushRows) => {
    queue = queue
      .then(async () => {
        if (rows) await saveRows(getSession, rows).catch((err) => console.error("[prewarm]", err));
        await prewarmOnce(getSession);
      })
      .catch((err) => console.error("[prewarm] failed:", err));
    return queue;
  };
};
