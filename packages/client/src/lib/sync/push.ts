import {
  getCurrentSubscription,
  removeSubscriptionFromServer,
  sendSubscriptionToServer,
  subscribe,
  unsubscribe,
} from "@mmmike/web-push/client";
import { apiHeaders } from "~/lib/api";
import { fetchServerConfig } from "~/lib/server-config";
import { getServerUrl } from "~/lib/server-url";
import { getBuildTarget } from "~/lib/build-target";

// Extension tabs never touch push: the Chrome background worker owns the extension's subscription,
// and a Firefox extension page has no service worker to subscribe with.
const ownsSubscription = () => getBuildTarget() === "browser";

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
    const result = await subscribe(vapidPublicKey);
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
  const subscription = await getCurrentSubscription();
  if (subscription) await uploadSubscription(subscription);
};

export const unregisterPushSubscription = async (): Promise<void> => {
  if (!ownsSubscription()) return;
  try {
    const endpoint = await unsubscribe();
    if (!endpoint) return;
    await removeSubscriptionFromServer(endpoint, `${getServerUrl()}/api/push/unsubscribe`, {
      method: "POST",
      headers: apiHeaders(),
    });
    console.log("[push] unregistered");
  } catch (err) {
    console.error("[push] unregister failed:", err);
  }
};

export const isPushSubscribed = async (): Promise<boolean> =>
  ownsSubscription() && !!(await getCurrentSubscription());
