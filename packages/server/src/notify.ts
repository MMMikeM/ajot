import userRepo from "./db/user.repo";
import { NOTIFICATION_TRIGGERS, type PushPayload } from "@newtab-todo/shared";
import { findRecipients, sendToDevices, withoutMuted } from "./push";

type NotificationPayload = Extract<PushPayload, { type: keyof typeof NOTIFICATION_TRIGGERS }>;

/**
 * Sent to each of the user's devices that hasn't muted it. A failed send to one device is counted,
 * not thrown; a subscription the push service rejects is removed.
 */
export const sendNotification = async (userId: string, payload: NotificationPayload) => {
  const recipients = await findRecipients([userId]);
  const subs = withoutMuted(
    recipients.subs,
    recipients.preferences,
    () => NOTIFICATION_TRIGGERS[payload.type],
  );
  if (subs.length === 0) return;

  const sent = await sendToDevices(subs, recipients.preferences, payload);
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
