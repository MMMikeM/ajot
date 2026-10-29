import { loadSnapshotEntry, saveSnapshot } from "~/lib/snapshot-store";
import type { SignedInSession } from "~/lib/api-client";

// The PWA's service worker can't read localStorage, where the token lives, so it gets a copy
const SESSION_KEY = "session";
const USER_KEY = "session-user";

export const shareSessionWithWorker = (token: string | null, userId: string | null) =>
  saveSnapshot([
    [SESSION_KEY, token ?? undefined],
    [USER_KEY, userId ?? undefined],
  ]).catch(console.error);

export const readWorkerSession = async (): Promise<SignedInSession | null> => {
  const [token, userId] = await Promise.all([
    loadSnapshotEntry(SESSION_KEY),
    loadSnapshotEntry(USER_KEY),
  ]);
  if (typeof token !== "string") return null;
  return { token, serverUrl: "", userId: typeof userId === "string" ? userId : null };
};
