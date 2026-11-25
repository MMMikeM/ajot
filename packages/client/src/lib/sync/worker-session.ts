import { getOrCreateDeviceId } from "~/lib/auth/device-id";
import { loadSnapshotEntry, saveSnapshot } from "~/lib/snapshot-store";
import type { SignedInSession } from "~/lib/api-client";

// The PWA's service worker can't read localStorage, where the token and device id live, so it gets
// a copy
const SESSION_KEY = "session";
const USER_KEY = "session-user";
const DEVICE_KEY = "session-device";

export const shareSessionWithWorker = (token: string | null, userId: string | null) =>
  saveSnapshot([
    // Kept as null, not removed, so the worker can tell a signed-out page from a store that was
    // recreated or never written, where unsubscribing would end push for an account still signed in
    [SESSION_KEY, token],
    [USER_KEY, userId ?? undefined],
    [DEVICE_KEY, getOrCreateDeviceId()],
  ]).catch(console.error);

export type WorkerSession = SignedInSession & { deviceId: string | null };

export const readWorkerSession = async (): Promise<WorkerSession | null> => {
  const [token, userId, deviceId] = await Promise.all([
    loadSnapshotEntry(SESSION_KEY),
    loadSnapshotEntry(USER_KEY),
    loadSnapshotEntry(DEVICE_KEY),
  ]);
  if (typeof token !== "string") return null;
  return {
    token,
    serverUrl: "",
    userId: typeof userId === "string" ? userId : null,
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
  };
};

/** Whether a page signed out, or its session expired, since it last shared one. */
export const workerSignedOut = async () => (await loadSnapshotEntry(SESSION_KEY)) === null;
