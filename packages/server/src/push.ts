import {
  rawPayload,
  sendPushBatch,
  WebPushError,
  type SendPushOptions,
  type VapidConfig,
} from "@mmmike/web-push";
import type { PushPayload } from "@newtab-todo/shared";
import pushSubscriptionRepo from "./db/push-subscription.repo";

const vapid: VapidConfig = {
  subject: process.env.VAPID_SUBJECT!,
  publicKey: process.env.VAPID_PUBLIC_KEY!,
  privateKey: process.env.VAPID_PRIVATE_KEY!,
};

type StoredSubscription = { endpoint: string; p256dh: string; auth: string };

/**
 * Send a typed payload to the given subscriptions, deleting the ones the push service reports
 * gone. Failed sends are logged, never thrown. Returns how many were delivered.
 */
export const sendPush = async (
  subs: StoredSubscription[],
  payload: PushPayload,
  options?: SendPushOptions,
) => {
  const { delivered, gone, failed } = await sendPushBatch(
    subs.map((sub) => ({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })),
    // The service workers parse our own PushPayload union, not the library's notification shape.
    rawPayload(JSON.stringify(payload)),
    vapid,
    options,
  );
  await pushSubscriptionRepo.removeMany(gone);
  if (failed.length > 0) {
    console.warn(
      `Push [${payload.type}] failed:`,
      failed.map(({ error }) => (error instanceof WebPushError ? error.toJSON() : String(error))),
    );
  }
  return delivered;
};

/**
 * Send a silent sync push to the affected users' extensions. Web subscriptions are skipped: a push
 * that shows nothing makes Chrome show its own notification, and Safari revokes the permission.
 * Expired/invalid subscriptions (410 Gone) are cleaned up automatically.
 */
export const notifyOtherDevices = async (userIds: string[]) => {
  const subs = await pushSubscriptionRepo.findForUsers(userIds, "extension");
  if (subs.length === 0) return;

  // A device that was offline only needs the latest sync, not one per mutation.
  const sent = await sendPush(subs, { type: "sync" }, { topic: "sync" });
  console.log(`Push: ${sent}/${subs.length} delivered`);
};
