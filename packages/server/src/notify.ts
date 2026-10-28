import userRepo from "./db/user.repo";
import type { NotificationPayload } from "./push-plan";
import { queueNotification } from "./push-queue";
import { writeNotification } from "./broadcast";

/**
 * Sent within a second, with any changes waiting for the same user, to each of their devices that
 * hasn't turned it off, and at once to their open event streams. Never throws: a failed send is
 * logged.
 */
export const sendNotification = (userId: string, payload: NotificationPayload) => {
  try {
    writeNotification(userId, payload);
    queueNotification(userId, payload);
  } catch (err) {
    console.error(`[notify] couldn't send ${payload.type} to ${userId}`, err);
  }
};

export const getUserName = async (userId: string): Promise<string> => {
  try {
    const user = await userRepo.findById(userId);
    if (user) return user.name;
  } catch (err) {
    console.error(`[notify] couldn't read ${userId}'s name`, err);
  }
  return "Someone";
};
