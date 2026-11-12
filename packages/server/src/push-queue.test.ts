import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { findRecipients, sendPush } from "./push";
import { flushPushes, queueChanges } from "./push-queue";
import { findNames } from "./db/user.repo";

vi.mock("./push", () => ({
  findRecipients: vi.fn(),
  sendPush: vi.fn(),
}));
vi.mock("./db/user.repo", () => ({ findNames: vi.fn() }));

const laptop = {
  endpoint: "laptop",
  userId: "me",
  deviceId: "laptop",
  kind: "web",
  p256dh: "",
  auth: "",
  createdAt: "",
};

const friendsLaptop = { ...laptop, endpoint: "friends-laptop", userId: "friend" };

const edit = (id: string) => ({ model: "tasks", action: "update", data: { id } }) as const;
const fromPhone = { userId: "me", deviceId: "phone" };

/** The task ids each send carried, in order. */
const sentIds = () =>
  vi
    .mocked(sendPush)
    .mock.calls.map(([, message]) =>
      message.rows?.events.map((event) => (event.data as { id: string }).id),
    );

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(findRecipients).mockImplementation(
    async ([userId]) =>
      ({
        subs: [laptop, friendsLaptop].filter((sub) => sub.userId === userId),
        preferences: new Map(),
      }) as never,
  );
  vi.mocked(sendPush).mockResolvedValue(1);
  vi.mocked(findNames).mockResolvedValue(new Map([["friend", "Sam"]]));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await flushPushes();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("queueChanges", () => {
  test("a steady stream of edits still sends every second", async () => {
    for (const id of ["a", "b", "c", "d"]) {
      queueChanges(["me"], [edit(id)], fromPhone);
      await vi.advanceTimersByTimeAsync(400);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sentIds()).toEqual([["a", "b", "c"], ["d"]]);
  });

  test("each user's batch holds only their changes", async () => {
    queueChanges(["me"], [edit("mine")], fromPhone);
    queueChanges(["friend"], [edit("theirs")], { userId: "friend" });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(sentIds()).toEqual([["mine"], ["theirs"]]);
  });

  test("says who else made a change, and still sends when that can't be read", async () => {
    queueChanges(["me"], [edit("theirs")], { userId: "friend" });
    await vi.advanceTimersByTimeAsync(1_000);
    vi.mocked(findNames).mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueChanges(["me"], [edit("theirs")], { userId: "friend" });
    await vi.advanceTimersByTimeAsync(1_000);

    const said = vi.mocked(sendPush).mock.calls.map(([, message]) => message);
    expect(said).toMatchObject([
      { changed: [{ id: "theirs", by: "Sam" }] },
      { changed: [{ id: "theirs", by: "Someone" }] },
    ]);
  });
});
