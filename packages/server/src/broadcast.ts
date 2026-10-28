import type { Context } from "hono";
import { queueChanges } from "./push-queue";
import type { ChangeSource } from "./push-plan";
import { SSE_NOTIFICATION, type MutationEvent, type ModelName } from "@newtab-todo/shared";
import type { NotificationPayload } from "./push-plan";

export type { MutationEvent };

type SSEWriter = { write: (event: string, data: string) => void; close: () => void };

const sseClients = new Map<string, Set<SSEWriter>>();

// Far more tabs than anyone keeps open, so a reconnecting tab never pushes out one in use; enough
// to stop one account holding the server's connections open
const MAX_STREAMS_PER_USER = 100;

export const registerClient = (userId: string, writer: SSEWriter) => {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  const writers = sseClients.get(userId)!;
  if (writers.size >= MAX_STREAMS_PER_USER) {
    const [oldest] = writers;
    writers.delete(oldest!);
    oldest!.close();
  }
  writers.add(writer);
};

export const unregisterClient = (userId: string, writer: SSEWriter) => {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(writer);
  if (set.size === 0) sseClients.delete(userId);
};

const writeEvents = (events: MutationEvent[], userIds: string[]) => {
  const payloads = events.map((event) => JSON.stringify(event));
  for (const uid of userIds) {
    for (const client of sseClients.get(uid) ?? []) {
      for (const payload of payloads) client.write("data-changed", payload);
    }
  }
};

export const writeNotification = (userId: string, payload: NotificationPayload) => {
  const data = JSON.stringify(payload);
  for (const client of sseClients.get(userId) ?? []) client.write(SSE_NOTIFICATION, data);
};

export const notifyMutation = (
  { sourceClientId, ...event }: MutationEvent,
  userIds: string[],
  source: ChangeSource = {},
) => {
  writeEvents([{ ...event, sourceClientId }], userIds);
  queueChanges(userIds, [event], source);
};

const changeSource = (c: Context): ChangeSource => ({
  userId: c.get("userId"),
  deviceId: c.req.header("x-device-id"),
});

export const closeAllClients = () => {
  for (const writers of sseClients.values()) {
    for (const writer of writers) writer.close();
  }
  sseClients.clear();
};

export const broadcast = (
  c: Context,
  model: ModelName,
  action: MutationEvent["action"],
  data: object,
  userIds: string[],
) => {
  notifyMutation(
    { model, action, data, sourceClientId: c.req.header("x-client-id") },
    userIds,
    changeSource(c),
  );
};

export type BroadcastEvent = Omit<MutationEvent, "sourceClientId">;

/** Broadcast several mutation events with one push per device, rather than one per event. */
export const broadcastAll = (c: Context, events: BroadcastEvent[], userIds: string[]) => {
  const sourceClientId = c.req.header("x-client-id");
  writeEvents(
    events.map((event) => ({ ...event, sourceClientId })),
    userIds,
  );
  queueChanges(userIds, events, changeSource(c));
};

/** Sends each user only the events addressed to them, with one push per user. */
export const broadcastPerUser = (
  c: Context,
  addressed: { userId: string; event: BroadcastEvent }[],
) => {
  for (const userId of new Set(addressed.map((a) => a.userId)))
    broadcastAll(
      c,
      addressed.filter((a) => a.userId === userId).map((a) => a.event),
      [userId],
    );
};
