import type { PushRows } from "@newtab-todo/shared/push-payload";
import {
  OWNER_KEY,
  SNAPSHOT_KEYS,
  loadSnapshotEntry,
  openSnapshotDb,
  readSnapshot,
  saveSnapshot,
  writeSnapshot,
} from "~/lib/snapshot-store";
import { applyRows } from "~/lib/sync/saved-rows";
import { ApiError, apiClient, type SignedInSession } from "~/lib/api-client";
import { listRoutes, type ListKey } from "~/lib/list-routes";
import { rowsOf, type FilesRun } from "~/lib/files/file-job";

type GetSession = () => Promise<SignedInSession | null>;

const fetchList = async (routes: ReturnType<typeof listRoutes>, key: ListKey) => {
  const res = await routes[key]();
  if (!res.ok) throw new ApiError(res.status, `/api/${key}`);
  return [key, (await res.json()) as unknown] as const;
};

const sameSession = (a: SignedInSession | null, b: SignedInSession) =>
  a?.token === b.token && a.serverUrl === b.serverUrl;

// Rows from another account (a device signed out while offline, still subscribed) never land
const saveRows = async (getSession: GetSession, rows: PushRows) => {
  const session = await getSession();
  if (!session || session.userId !== rows.userId) return;
  const db = await openSnapshotDb();
  try {
    const models = [...new Set(rows.events.map((event) => event.model))];
    const saved = await readSnapshot(db, [...models, OWNER_KEY]);
    const owner = saved.get(OWNER_KEY);
    if (owner !== undefined && owner !== rows.userId) return;
    await writeSnapshot(db, [...applyRows(saved, rows.events), [OWNER_KEY, rows.userId]]);
  } finally {
    db.close();
  }
};

/** What a run saved: the session it ran for, and its attachments list when that answered 200. */
export type PrewarmRun = { session: SignedInSession; attachments?: unknown; startedAt: number };

const prewarmOnce = async (getSession: GetSession): Promise<PrewarmRun | undefined> => {
  const session = await getSession();
  if (!session) return undefined;
  const startedAt = Date.now();
  const routes = listRoutes(apiClient(session));
  const results = await Promise.allSettled(SNAPSHOT_KEYS.map((key) => fetchList(routes, key)));
  // Signed out or into another account meanwhile: the next tab must not open on these lists
  if (!sameSession(await getSession(), session)) return undefined;
  const lists = results.flatMap((result) => {
    if (result.status === "fulfilled") return [result.value];
    console.error("[prewarm]", result.reason);
    return [];
  });
  if (lists.length === 0) return undefined;
  const owner = session.userId ?? undefined;
  // A list that failed to fetch keeps what was saved, unless that was another account's
  const fetched = new Set(lists.map(([key]) => key));
  const stale =
    (await loadSnapshotEntry(OWNER_KEY)) === owner
      ? []
      : SNAPSHOT_KEYS.filter((key) => !fetched.has(key)).map((key) => [key, undefined] as const);
  await saveSnapshot([...lists, ...stale, [OWNER_KEY, owner]]);
  return { session, attachments: lists.find(([key]) => key === "attachments")?.[1], startedAt };
};

/**
 * Saves the server's lists where a page reads them on startup, so one opened offline shows what
 * the server last had. A push's rows are saved first, so they're kept if the fetch then fails.
 * The returned function never rejects, and resolves with what the run saved; calls run one at a
 * time, so an earlier fetch can never save over a later one.
 */
export const createPrewarm = (getSession: GetSession) => {
  let queue: Promise<PrewarmRun | undefined> = Promise.resolve(undefined);
  return (rows?: PushRows) => {
    queue = queue
      .then(async () => {
        if (rows) await saveRows(getSession, rows).catch((err) => console.error("[prewarm]", err));
        return prewarmOnce(getSession);
      })
      .catch((err) => {
        console.error("[prewarm] failed:", err);
        return undefined;
      });
    return queue;
  };
};

/** The file job's view of a run: a list that answered 200 counts as fresh. */
export const filesRunOf = ({ session, attachments, startedAt }: PrewarmRun): FilesRun => ({
  session,
  rows: rowsOf(attachments),
  ...(attachments !== undefined && { fetchedAt: startedAt }),
});
