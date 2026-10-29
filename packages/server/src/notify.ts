import userRepo from "./db/user.repo";
import type { NotificationPayload } from "./push-plan";
import { queueNotification } from "./push-queue";
import { writeNotification } from "./broadcast";

export const sendNotification = (userId: string, payload: NotificationPayload) => {
  // Apart, so a stream that fails to write doesn't cost the user's devices their push
  for (const send of [queueNotification, writeNotification]) {
    try {
      send(userId, payload);
    } catch (err) {
      console.error(`[notify] couldn't send ${payload.type} to ${userId}`, err);
    }
  }
};

export const getUserName = async (userId: string): Promise<string> => {
  try {
    const name = await userRepo.findName(userId);
    if (name !== undefined) return name;
  } catch (err) {
    console.error(`[notify] couldn't read ${userId}'s name`, err);
  }
  return "Someone";
};
