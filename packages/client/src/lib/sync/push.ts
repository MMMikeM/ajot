import {
  getCurrentSubscription,
  removeSubscriptionFromServer,
  sendSubscriptionToServer,
  subscribe,
  unsubscribe,
} from "@mmmike/web-push/client";
import { apiHeaders, serverUrl } from "~/lib/api";
import { getBuildTarget } from "~/lib/build-target";

// Extension tabs never touch push: the Chrome background worker owns the extension's subscription,
// and a Firefox extension page has no service worker to subscribe with.
const ownsSubscription = () => getBuildTarget() === "browser";

const uploadSubscription = async (subscription: PushSubscription) => {
  const ok = await sendSubscriptionToServer(subscription, `${serverUrl}/api/push/subscribe`, {
    headers: apiHeaders(),
  });
  if (!ok) throw new Error("subscription upload failed");
};

export const registerPushSubscription = async (vapidPublicKey: string): Promise<boolean> => {
  if (!ownsSubscription()) return false;

  try {
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

export const unregisterPushSubscription = async (): Promise<void> => {
  if (!ownsSubscription()) return;
  try {
    const endpoint = await unsubscribe();
    if (!endpoint) return;
    await removeSubscriptionFromServer(endpoint, `${serverUrl}/api/push/unsubscribe`, {
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

export const ensurePushRegistered = async (): Promise<void> => {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  if (!vapidKey) {
    console.warn("[push] no VITE_VAPID_PUBLIC_KEY");
    return;
  }
  await registerPushSubscription(vapidKey);
};
