import type { SendPushOptions } from "@mmmike/web-push/send";
import {
  NOTIFICATION_TRIGGERS,
  type MutationEvent,
  type PushMessage,
  type PushPayload,
  type PushTrigger,
} from "@newtab-todo/shared";

export type DevicePreferences = { muted: PushTrigger[]; urgent: boolean };

// One 4096-byte record less its header, padding delimiter and tag (RFC 8291 §4); the library
// throws for anything longer, before sending to anyone
const MAX_PAYLOAD_BYTES = 3993;

/** A plain "changes" still makes the device fetch the lists, which is what every push is for. */
export const fitted = (message: PushMessage): PushMessage => {
  if (Buffer.byteLength(JSON.stringify(message)) <= MAX_PAYLOAD_BYTES) return message;
  const { rows, ...withoutRows } = message;
  return rows ? fitted(withoutRows) : { type: "changes" };
};

export const DEFAULT_PUSH_PREFERENCES: DevicePreferences = { muted: [], urgent: true };

export const deviceKey = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

export type ChangeSource = { userId?: string; deviceId?: string };

export type NotificationPayload = Extract<
  PushPayload,
  { type: keyof typeof NOTIFICATION_TRIGGERS }
>;

export type PushBatch = {
  changes: { event: Omit<MutationEvent, "sourceClientId">; source: ChangeSource }[];
  notifications: NotificationPayload[];
};

type Recipient = {
  userId: string;
  deviceId: string | null;
  kind: "web" | "extension";
};

export type PlannedPush<S> = { subs: S[]; message: PushMessage; options: SendPushOptions };

// Only the PWA uploads a device id, so the extensions always get the defaults
const preferencesOf = (sub: Recipient, preferences: Map<string, DevicePreferences>) =>
  (sub.deviceId !== null && preferences.get(deviceKey(sub.userId, sub.deviceId))) ||
  DEFAULT_PUSH_PREFERENCES;

/**
 * Every push makes a device save the lists, so one sent a notification needs no other. High
 * urgency wakes an idle phone to save them before it goes offline.
 */
export const planPushes = <S extends Recipient>(
  userId: string,
  batch: PushBatch,
  subs: S[],
  preferences: Map<string, DevicePreferences>,
): PlannedPush<S>[] => {
  const rows =
    batch.changes.length > 0
      ? { userId, events: batch.changes.map((change) => change.event) }
      : undefined;
  const planned = new Map<string, PlannedPush<S>>();
  const add = (sub: S, payload: PushPayload, options: SendPushOptions) => {
    const message = rows ? { ...payload, rows } : payload;
    const key = JSON.stringify([message, options]);
    const push: PlannedPush<S> = planned.get(key) ?? { subs: [], message, options };
    push.subs.push(sub);
    planned.set(key, push);
  };

  for (const sub of subs) {
    const { muted, urgent } = preferencesOf(sub, preferences);
    const urgency = urgent ? "high" : "normal";
    const notifications = batch.notifications.filter(
      (notification) => !muted.includes(NOTIFICATION_TRIGGERS[notification.type]),
    );
    for (const notification of notifications) add(sub, notification, { urgency });
    if (notifications.length > 0 || batch.changes.length === 0) continue;

    if (sub.kind === "extension") {
      add(sub, { type: "sync" }, { topic: "sync", urgency });
      continue;
    }
    // Only a worker new enough to show "changes" uploads a device id; an older one would show
    // nothing, which is the silent push Chrome and Safari punish
    if (sub.deviceId === null) continue;
    const triggers = batch.changes
      .filter(({ source }) => source.deviceId !== sub.deviceId)
      .map(({ source }): PushTrigger =>
        source.userId === userId ? "own-changes" : "others-changes",
      );
    // A device that was offline only needs the latest one
    if (triggers.some((trigger) => !muted.includes(trigger)))
      add(sub, { type: "changes" }, { topic: "changes", urgency });
  }
  return [...planned.values()];
};
