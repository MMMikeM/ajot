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
const unowned = { endpoint: "unowned", userId: null, deviceId: null, kind: "extension" } as const;

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

  test("devices with the same settings share one send", () => {
    const pushes = planPushes(ME, changeFrom("tablet"), [phone, laptop], new Map());

    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.subs).toEqual([phone, laptop]);
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

  test("a device that chose to wait gets normal urgency", () => {
    const pushes = planPushes(
      ME,
      changeFrom("tablet"),
      [phone, laptop],
      prefs([[phone, { urgent: false }]]),
    );

    const urgencyOf = (endpoint: string) =>
      pushes.find((push) => push.subs.some((sub) => sub.endpoint === endpoint))?.options.urgency;
    expect(urgencyOf("phone")).toBe("normal");
    expect(urgencyOf("laptop")).toBe("high");
  });

  test("a subscription with no account never gets anyone's rows", () => {
    const pushes = planPushes(ME, changeFrom("phone"), [unowned], new Map());

    expect(sentTo(pushes)).toEqual({ unowned: ["sync"] });
    expect(pushes[0]!.message.rows).toBeUndefined();
  });
});

describe("fitted", () => {
  const rows = { userId: ME, events: [{ ...event, data: { id: "t1", title: "x".repeat(4000) } }] };

  test("drops rows that don't fit, keeping the push", () => {
    expect(fitted({ type: "changes", rows })).toEqual({ type: "changes" });
  });

  test("keeps rows that fit", () => {
    const small = { userId: ME, events: [event] };
    expect(fitted({ type: "changes", rows: small })).toEqual({ type: "changes", rows: small });
  });

  test("gives up on a push too long without rows", () => {
    expect(fitted({ ...shared, taskTitle: "x".repeat(4000) })).toBeNull();
  });
});
