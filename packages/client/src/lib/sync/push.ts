import {
  removeSubscriptionFromServer,
  sendSubscriptionToServer,
  subscribe,
} from "@mmmike/web-push/client";
import { apiHeaders, client } from "~/lib/api";
import { getOrCreateDeviceId } from "~/lib/auth/current-user";
import { fetchServerConfig } from "~/lib/server-config";
import { getServerUrl } from "~/lib/server-url";
import { getBuildTarget } from "~/lib/build-target";

// Extension tabs never touch push: the Chrome background worker owns the extension's subscription,
// and a Firefox extension page has no service worker to subscribe with.
const ownsSubscription = () => getBuildTarget() === "browser";

/**
 * The page's worker registration, without waiting for one. The library otherwise waits on
 * `serviceWorker.ready`, which never settles where no worker registers (blocked, failed to
 * install, a browser without them).
 */
const findRegistration = async () => {
  if (!("serviceWorker" in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
};

// Only an active worker can have been subscribed, so this never waits for one to install
const findSubscription = async () => {
  const registration = await findRegistration();
  if (!registration?.active || !("PushManager" in window)) return null;
  return registration.pushManager.getSubscription();
};

const uploadSubscription = async (subscription: PushSubscription) => {
  const ok = await sendSubscriptionToServer(subscription, `${getServerUrl()}/api/push/subscribe`, {
    headers: apiHeaders(),
  });
  if (!ok) throw new Error("subscription upload failed");
};

export const registerPushSubscription = async (): Promise<boolean> => {
  if (!ownsSubscription()) return false;

  try {
    const { vapidPublicKey } = await fetchServerConfig(getServerUrl());
    if (!vapidPublicKey) {
      console.warn("[push] the server has no VAPID_PUBLIC_KEY");
      return false;
    }
    const registration = await findRegistration();
    if (!registration) {
      console.log("[push] not subscribed: no service worker");
      return false;
    }
    const result = await subscribe(vapidPublicKey, { registration });
    if (result.status !== "subscribed") {
      console.log("[push] not subscribed:", result.status);
      return false;
    }
    await uploadSubscription(result.subscription);
    console.log("[push] registered", result.isNew ? "(new subscription)" : "");
    return true;
  } catch (err) {
    console.error("[push] registration failed:", err);
    return false;
  }
};

/**
 * Uploads this device's subscription again, now with its device id, so the server can send it
 * changes made elsewhere and not its own. Never subscribes, so it can't prompt.
 */
export const refreshPushSubscription = async () => {
  if (!ownsSubscription()) return;
  const subscription = await findSubscription();
  if (subscription) await uploadSubscription(subscription);
};

/**
 * `headers` sign the request: signing out passes the session it's about to end, which the server
 * still has to accept.
 */
export const unregisterPushSubscription = async (headers = apiHeaders()): Promise<void> => {
  if (!ownsSubscription()) return;
  try {
    const subscription = await findSubscription();
    if (!subscription) return;
    // Nothing waits on the push service, which may never answer: signing out ends the session
    // once the server has dropped the endpoint, and the server needs only that to stop sending
    subscription.unsubscribe().catch(console.error);
    await removeSubscriptionFromServer(
      subscription.endpoint,
      `${getServerUrl()}/api/push/unsubscribe`,
      { method: "POST", headers, keepalive: true },
    );
    console.log("[push] unregistered");
  } catch (err) {
    console.error("[push] unregister failed:", err);
  }
};

export const isPushSubscribed = async (): Promise<boolean> =>
  ownsSubscription() && !!(await findSubscription());

export const pushBlocker = (): "unsupported" | "denied" | null => {
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "denied" : null;
};

const deviceHeader = () => ({ "x-device-id": getOrCreateDeviceId() });

export const fetchPushPreferences = async () => {
  const res = await client.api.push.preferences.$get({ header: deviceHeader() });
  if (!res.ok) throw new Error("Couldn't load notification settings");
  return res.json();
};

export type PushPreferences = Awaited<ReturnType<typeof fetchPushPreferences>>;

const putPushPreferences = async (preferences: PushPreferences) => {
  const res = await client.api.push.preferences.$put({ header: deviceHeader(), json: preferences });
  if (!res.ok) throw new Error("Couldn't save notification settings");
};

// One at a time, so a quick second change can't be overtaken by the first
let saving: Promise<unknown> = Promise.resolve();
export const savePushPreferences = (preferences: PushPreferences) => {
  const save = saving.then(() => putPushPreferences(preferences));
  saving = save.catch(() => {});
  return save;
};
