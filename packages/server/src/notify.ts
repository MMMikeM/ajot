import userRepo from "./db/user.repo";
import type { NotificationPayload } from "./push-plan";
import { queueNotification } from "./push-queue";

/**
 * Sent within a second, with any changes waiting for the same user, to each of their devices that
 * hasn't turned it off. Never throws: a failed send is logged.
 */
export const sendNotification = async (userId: string, payload: NotificationPayload) =>
  queueNotification(userId, payload);

export const getUserName = async (userId: string): Promise<string> => {
  try {
    const user = await userRepo.findById(userId);
    return user.name;
  } catch {
    return "Someone";
  }
};
