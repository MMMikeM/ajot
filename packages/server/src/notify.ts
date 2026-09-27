import pushSubscriptionRepo from "./db/push-subscription.repo";
import userRepo from "./db/user.repo";
import type { PushPayload } from "@newtab-todo/shared";
import { sendPush } from "./push";

/** A failed send to one device is counted, not thrown; a subscription the push service rejects is removed. */
export const sendNotification = async (userId: string, payload: PushPayload) => {
  const subs = await pushSubscriptionRepo.findForUsers([userId]);
  if (subs.length === 0) return;

  const sent = await sendPush(subs, payload);
  console.log(`Notification [${payload.type}] to ${userId}: ${sent}/${subs.length} delivered`);
};

export const getUserName = async (userId: string): Promise<string> => {
  try {
    const user = await userRepo.findById(userId);
    return user.name;
  } catch {
    return "Someone";
  }
};
