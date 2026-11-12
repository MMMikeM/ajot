import type { SendPushOptions } from "@mmmike/web-push/send";
import {
  MAX_CHANGED_NAME,
  mergeChanges,
  NOTIFICATION_TRIGGERS,
  type ChangedItem,
  type ChangeSummary,
  type ModelName,
  type MutationEvent,
  type PushMessage,
  type PushPayload,
  type PushTrigger,
} from "@newtab-todo/shared";

export type DevicePreferences = { muted: PushTrigger[]; urgent: boolean };

// One 4096-byte record less its header, padding delimiter and tag (RFC 8291 §4); the library
// throws for anything longer, before sending to anyone
const MAX_PAYLOAD_BYTES = 3993;

/**
 * The rows go first, then half the changes listed at a time. A plain "changes" still makes the
 * device fetch the lists, which is what every push is for.
 */
export const fitted = (message: PushMessage): PushMessage => {
  if (Buffer.byteLength(JSON.stringify(message)) <= MAX_PAYLOAD_BYTES) return message;
  const { rows, ...withoutRows } = message;
  if (rows) return fitted(withoutRows);
  if (message.type !== "changes" || !message.changed || message.changed.length <= 1)
    return { type: "changes" };
  const kept = Math.floor(message.changed.length / 2);
  return fitted({
    type: "changes",
    changed: message.changed.slice(0, kept),
    more: (message.more ?? 0) + message.changed.length - kept,
  });
};

export const DEFAULT_PUSH_PREFERENCES: DevicePreferences = { muted: [], urgent: true };

export const deviceKey = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

export type ChangeSource = { userId?: string; deviceId?: string };

type Change = PushBatch["changes"][number];

// What each kind of row is called by, in the rows the server broadcasts
const NAME_FIELDS: Partial<Record<ModelName, string>> = {
  tasks: "title",
  notes: "title",
  categories: "name",
  attachments: "name",
};

const nameOf = ({ model, data }: Change["event"]) => {
  const field = NAME_FIELDS[model];
  const name = field && (data as Record<string, unknown>)[field];
  if (typeof name !== "string" || !name.trim()) return undefined;
  const trimmed = name.trim();
  return trimmed.length > MAX_CHANGED_NAME ? `${trimmed.slice(0, MAX_CHANGED_NAME - 1)}…` : trimmed;
};

/** What a device is told changed, each change named by who made it unless it was them. */
const summarise = (
  userId: string,
  changes: Change[],
  names: ReadonlyMap<string, string>,
): ChangeSummary =>
  mergeChanges(undefined, {
    changed: changes.flatMap(({ event, source }): ChangedItem[] => {
      const id = (event.data as { id?: unknown }).id;
      if (typeof id !== "string") return [];
      const by =
        source.userId === userId ? undefined : (names.get(source.userId ?? "") ?? "Someone");
      return [{ id, model: event.model, action: event.action, name: nameOf(event), by }];
    }),
    more: 0,
  });

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
  /** Of whoever made the batch's changes, for telling the others who did */
  names: ReadonlyMap<string, string> = new Map(),
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
    const heard = batch.changes.filter(
      ({ source }) =>
        source.deviceId !== sub.deviceId &&
        !muted.includes(source.userId === userId ? "own-changes" : "others-changes"),
    );
    // A device that was offline only needs the latest one
    if (heard.length > 0)
      add(
        sub,
        { type: "changes", ...summarise(userId, heard, names) },
        { topic: "changes", urgency },
      );
  }
  return [...planned.values()];
};
