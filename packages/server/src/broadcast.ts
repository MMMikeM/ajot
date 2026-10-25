import type { Context } from "hono";
import { notifyOtherDevices, type ChangeSource } from "./push";
import type { MutationEvent, ModelName } from "@newtab-todo/shared";

export type { MutationEvent };

type SSEWriter = { write: (event: string, data: string) => void; close: () => void };

const sseClients = new Map<string, Set<SSEWriter>>();

export const registerClient = (userId: string, writer: SSEWriter) => {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId)!.add(writer);
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

export const notifyMutation = (event: MutationEvent, userIds: string[], source?: ChangeSource) => {
  writeEvents([event], userIds);
  notifyOtherDevices(userIds, source).catch(() => {});
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

type BroadcastEvent = Omit<MutationEvent, "sourceClientId">;

/** Broadcast several mutation events with one push per device, rather than one per event. */
export const broadcastAll = (c: Context, events: BroadcastEvent[], userIds: string[]) => {
  const sourceClientId = c.req.header("x-client-id");
  writeEvents(
    events.map((event) => ({ ...event, sourceClientId })),
    userIds,
  );
  notifyOtherDevices(userIds, changeSource(c)).catch(() => {});
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
