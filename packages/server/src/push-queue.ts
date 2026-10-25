import type { MutationEvent } from "@newtab-todo/shared";
import { findRecipients, sendPush } from "./push";
import {
  planPushes,
  type ChangeSource,
  type NotificationPayload,
  type PushBatch,
} from "./push-plan";

// Long enough to take in a burst, like the edits a device replays when it comes back online
const GROUP_FOR_MS = 1_000;

const pending = new Map<string, PushBatch & { timer: NodeJS.Timeout }>();

// Sent a fixed time after its first entry, so a steady stream of edits can't keep putting it off
const batchFor = (userId: string) => {
  let batch = pending.get(userId);
  if (!batch) {
    const timer = setTimeout(() => void flush(userId), GROUP_FOR_MS);
    batch = { changes: [], notifications: [], timer };
    pending.set(userId, batch);
  }
  return batch;
};

const flush = async (userId: string) => {
  const batch = pending.get(userId);
  if (!batch) return;
  pending.delete(userId);
  clearTimeout(batch.timer);
  try {
    const { subs, preferences } = await findRecipients([userId]);
    const pushes = planPushes(userId, batch, subs, preferences);
    if (pushes.length === 0) return;
    const delivered = await Promise.all(
      pushes.map((push) => sendPush(push.subs, push.message, push.options)),
    );
    const sent = delivered.reduce((sum, count) => sum + count, 0);
    const tried = pushes.reduce((sum, push) => sum + push.subs.length, 0);
    console.log(
      `Push to ${userId}: ${sent}/${tried} delivered for ${batch.changes.length} changes, ` +
        `${batch.notifications.length} notifications`,
    );
  } catch (err) {
    console.error(`Push to ${userId} failed:`, err);
  }
};

/** Wake each user's other devices to save these changes, so each opens offline on them. */
export const queueChanges = (
  userIds: string[],
  events: Omit<MutationEvent, "sourceClientId">[],
  source: ChangeSource,
) => {
  for (const userId of new Set(userIds))
    batchFor(userId).changes.push(...events.map((event) => ({ event, source })));
};

export const queueNotification = (userId: string, payload: NotificationPayload) => {
  batchFor(userId).notifications.push(payload);
};

/** For a server about to stop: send what's waiting now. */
export const flushPushes = () => Promise.all([...pending.keys()].map(flush));
