import { describe, expect, test } from "vite-plus/test";
import {
  deviceKey,
  fitted,
  planPushes,
  type DevicePreferences,
  type NotificationPayload,
  type PlannedPush,
  type PushBatch,
} from "./push-plan";

const ME = "me";
const FRIEND = "friend";

const phone = { endpoint: "phone", userId: ME, deviceId: "phone", kind: "web" } as const;
const laptop = { endpoint: "laptop", userId: ME, deviceId: "laptop", kind: "web" } as const;
const extension = { endpoint: "ext", userId: ME, deviceId: null, kind: "extension" } as const;

const event = { model: "tasks", action: "insert", data: { id: "t1", title: "Milk" } } as const;
const shared: NotificationPayload = {
  type: "task-shared",
  taskId: "t1",
  taskTitle: "Milk",
  fromUser: "Sam",
};

const changeFrom = (deviceId: string, userId = ME): PushBatch => ({
  changes: [{ event, source: { userId, deviceId } }],
  notifications: [],
});

const prefs = (entries: [typeof phone | typeof laptop, Partial<DevicePreferences>][]) =>
  new Map(
    entries.map(([sub, p]) => [
      deviceKey(sub.userId, sub.deviceId),
      { muted: [], urgent: true, ...p },
    ]),
  );

/** What each subscription is sent: its messages' types, in order. */
const sentTo = (pushes: PlannedPush<{ endpoint: string }>[]) => {
  const by: Record<string, string[]> = {};
  for (const push of pushes)
    for (const sub of push.subs) (by[sub.endpoint] ??= []).push(push.message.type);
  return by;
};

describe("planPushes", () => {
  test("a change reaches every device but the one that made it, with its rows", () => {
    const pushes = planPushes(ME, changeFrom("phone"), [phone, laptop, extension], new Map());

    expect(sentTo(pushes)).toEqual({ laptop: ["changes"], ext: ["sync"] });
    for (const push of pushes) expect(push.message.rows).toEqual({ userId: ME, events: [event] });
  });

  test("a device that turned off its own changes still hears about someone else's", () => {
    const muted = prefs([[laptop, { muted: ["own-changes"] }]]);

    expect(sentTo(planPushes(ME, changeFrom("phone"), [laptop], muted))).toEqual({});
    expect(sentTo(planPushes(ME, changeFrom("their-phone", FRIEND), [laptop], muted))).toEqual({
      laptop: ["changes"],
    });
  });

  test("a notification replaces the general push, and carries the rows", () => {
    const batch = { ...changeFrom("tablet", FRIEND), notifications: [shared] };
    const pushes = planPushes(ME, batch, [laptop, extension], new Map());

    expect(sentTo(pushes)).toEqual({ laptop: ["task-shared"], ext: ["task-shared"] });
    expect(pushes[0]!.message.rows?.events).toEqual([event]);
  });

  test("a notification turned off falls back to the general push, if there are changes", () => {
    const muted = prefs([[laptop, { muted: ["shared"] }]]);
    const withChange = { ...changeFrom("tablet", FRIEND), notifications: [shared] };

    expect(sentTo(planPushes(ME, withChange, [laptop], muted))).toEqual({ laptop: ["changes"] });
    expect(
      sentTo(planPushes(ME, { changes: [], notifications: [shared] }, [laptop], muted)),
    ).toEqual({});
  });
});

describe("what a change push says", () => {
  const edit = (id: string, deviceId: string, userId = ME) => ({
    event: { model: "tasks", action: "update", data: { id, title: `Task ${id}` } } as const,
    source: { userId, deviceId },
  });
  const said = (batch: PushBatch, muted = new Map<string, DevicePreferences>()) =>
    planPushes(ME, batch, [laptop], muted, new Map([[FRIEND, "Sam"]]))[0]?.message;

  test("leaves out what the device did itself, and names who else did", () => {
    const batch = {
      changes: [edit("a", "laptop"), edit("b", "phone"), edit("c", "their-phone", FRIEND)],
      notifications: [],
    };

    expect(said(batch)).toMatchObject({
      changed: [
        { id: "b", name: "Task b", by: undefined },
        { id: "c", name: "Task c", by: "Sam" },
      ],
    });
  });

  test("leaves out what the device turned off", () => {
    const batch = {
      changes: [edit("b", "phone"), edit("c", "their-phone", FRIEND)],
      notifications: [],
    };
    const muted = prefs([[laptop, { muted: ["own-changes"] }]]);

    expect(said(batch, muted)).toMatchObject({ changed: [{ id: "c", by: "Sam" }] });
  });
});

describe("fitted", () => {
  const rows = { userId: ME, events: [{ ...event, data: { id: "t1", title: "x".repeat(4000) } }] };

  test("drops rows that don't fit, keeping the push", () => {
    expect(fitted({ type: "changes", rows })).toEqual({ type: "changes" });
  });

  test("keeps what changed when the rows go, listing fewer before giving up on it", () => {
    const changed = Array.from({ length: 20 }, (_, i) => ({
      id: `t${i}`,
      model: "tasks" as const,
      action: "update" as const,
      name: "x".repeat(60),
    }));
    expect(fitted({ type: "changes", changed: changed.slice(0, 2), more: 0, rows })).toEqual({
      type: "changes",
      changed: changed.slice(0, 2),
      more: 0,
    });
    const long = changed.map((item) => ({ ...item, name: "x".repeat(300) }));
    expect(fitted({ type: "changes", changed: long, more: 1 })).toMatchObject({
      changed: long.slice(0, 10),
      more: 11,
    });
  });

  test("turns a push too long without rows into a plain one", () => {
    expect(fitted({ ...shared, taskTitle: "x".repeat(4000), rows })).toEqual({ type: "changes" });
  });
});
