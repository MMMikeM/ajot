import { SNAPSHOT_KEYS, saveSnapshot } from "~/lib/snapshot-store";

/** serverUrl is "" for the PWA, which calls its own origin. */
export type PrewarmSession = { token: string; serverUrl: string };

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
 * the server last had. The returned function never rejects; calls run one at a time, so an
 * earlier fetch can never save over a later one.
 */
export const createPrewarm = (getSession: GetSession) => {
  let queue = Promise.resolve();
  return () => {
    queue = queue
      .then(() => prewarmOnce(getSession))
      .catch((err) => console.error("[prewarm] failed:", err));
    return queue;
  };
};
