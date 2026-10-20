import pushSubscriptionRepo from "./db/push-subscription.repo";
import userRepo from "./db/user.repo";
import type { PushPayload } from "@newtab-todo/shared";
import { sendPush } from "./push";

/**
 * Send a typed push notification to a single user's devices.
 * Fire-and-forget — failures are logged, not thrown. Expired subs are cleaned up.
 */
export const sendNotification = async (userId: string, payload: PushPayload) => {
  const subs = await pushSubscriptionRepo.findForUsers([userId]);
  if (subs.length === 0) return;

  const sent = await sendPush(subs, payload);
  console.log(`Notification [${payload.type}] to ${userId}: ${sent}/${subs.length} delivered`);
};

/**
 * Look up a user's display name by ID. Returns "Someone" if lookup fails.
 */
export const getUserName = async (userId: string): Promise<string> => {
  try {
    const user = await userRepo.findById(userId);
    return user.name;
  } catch {
    return "Someone";
  }
};
