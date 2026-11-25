import type { MutationEvent } from "@newtab-todo/shared";
import { findRecipients, sendPush } from "./push";
import * as userRepo from "./db/user.repo";
import {
  planPushes,
  type ChangeSource,
  type NotificationPayload,
  type PushBatch,
} from "./push-plan";

// Long enough to take in a burst, like the edits a device replays when it comes back online
const GROUP_FOR_MS = 1_000;

// Long enough for a database blip to pass
const RETRY_DELAYS_MS = [5_000, 15_000, 40_000];

type Pending = PushBatch & { timer: NodeJS.Timeout; retries: number };

const pending = new Map<string, Pending>();
const flushing = new Set<Promise<void>>();

const flushIn = (userId: string, delayMs: number) =>
  setTimeout(() => {
    const flushed = flush(userId).finally(() => flushing.delete(flushed));
    flushing.add(flushed);
  }, delayMs);

// Sent a fixed time after its first entry, so a steady stream of edits can't keep putting it off
const batchFor = (userId: string) => {
  let batch = pending.get(userId);
  if (!batch) {
    batch = { changes: [], notifications: [], timer: flushIn(userId, GROUP_FOR_MS), retries: 0 };
    pending.set(userId, batch);
  }
  return batch;
};

/** Ahead of anything queued since, so each device gets the changes in the order they were made. */
const requeue = (userId: string, failed: Pending) => {
  const delayMs = RETRY_DELAYS_MS[failed.retries];
  if (delayMs === undefined) {
    console.error(
      `Push to ${userId}: gave up on ${failed.changes.length} changes, ` +
        `${failed.notifications.length} notifications`,
    );
    return;
  }
  const batch = pending.get(userId) ?? {
    changes: [],
    notifications: [],
    timer: flushIn(userId, delayMs),
    retries: 0,
  };
  batch.changes.unshift(...failed.changes);
  batch.notifications.unshift(...failed.notifications);
  batch.retries = Math.max(batch.retries, failed.retries + 1);
  pending.set(userId, batch);
};

const plan = async (userId: string, batch: PushBatch) => {
  const othersIds = batch.changes.flatMap(({ source }) =>
    source.userId && source.userId !== userId ? [source.userId] : [],
  );
  const [{ subs, preferences }, names] = await Promise.all([
    findRecipients([userId]),
    // Without them the push still goes, saying "Someone"
    userRepo.findNames([...new Set(othersIds)]).catch((err: unknown) => {
      console.error(`Push to ${userId}: couldn't read who made the changes:`, err);
      return new Map<string, string>();
    }),
  ]);
  return planPushes(userId, batch, subs, preferences, names);
};

const flush = async (userId: string) => {
  const batch = pending.get(userId);
  if (!batch) return;
  pending.delete(userId);
  clearTimeout(batch.timer);
  const pushes = await plan(userId, batch).catch((err: unknown) => {
    console.error(`Push to ${userId}: couldn't read its devices:`, err);
    requeue(userId, batch);
    return [];
  });
  if (pushes.length === 0) return;
  // Not retried as a batch from here: some devices may already have it
  try {
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

/** For a server about to stop: send what's waiting now, and finish what's being sent. */
export const flushPushes = () => Promise.all([...flushing, ...[...pending.keys()].map(flush)]);
