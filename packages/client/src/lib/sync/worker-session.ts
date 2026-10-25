import { loadSnapshotEntry, saveSnapshot } from "~/lib/snapshot-store";
import type { PrewarmSession } from "~/lib/sync/prewarm";

// The PWA's service worker can't read localStorage, where the token lives, so it gets a copy
const SESSION_KEY = "session";

export const shareSessionWithWorker = (token: string | null) =>
  saveSnapshot([[SESSION_KEY, token ?? undefined]]).catch(console.error);

export const readWorkerSession = async (): Promise<PrewarmSession | null> => {
  const token = await loadSnapshotEntry(SESSION_KEY);
  return typeof token === "string" ? { token, serverUrl: "" } : null;
};
