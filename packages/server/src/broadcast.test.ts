import { expect, test, vi } from "vite-plus/test";
import {
  hasRoomForStream,
  notifyMutation,
  registerClient,
  unregisterClient,
  writeNotification,
} from "./broadcast";

vi.mock("./push-queue", () => ({ queueChanges: vi.fn() }));

const stream = () => ({ write: vi.fn(), close: vi.fn() });

test("one account's hundredth stream leaves no room for another, and closes none", () => {
  const streams = Array.from({ length: 100 }, stream);
  for (const writer of streams) {
    expect(hasRoomForStream("alice")).toBe(true);
    registerClient("alice", writer);
  }
  expect(hasRoomForStream("alice")).toBe(false);
  expect(hasRoomForStream("bob")).toBe(true);

  notifyMutation({ model: "tasks", action: "update", data: { id: "t" } }, ["alice"]);
  for (const writer of streams) {
    expect(writer.close).not.toHaveBeenCalled();
    expect(writer.write).toHaveBeenCalledTimes(1);
  }

  unregisterClient("alice", streams[0]!);
  expect(hasRoomForStream("alice")).toBe(true);
  for (const writer of streams) unregisterClient("alice", writer);
});

test("a notification reaches only its user's open streams, as its own event", () => {
  const bobs = stream();
  const carols = stream();
  registerClient("bob", bobs);
  registerClient("carol", carols);
  const payload = {
    type: "task-sent",
    taskId: "t1",
    taskTitle: "Milk",
    fromUser: "Alice",
  } as const;
  writeNotification("bob", payload);
  expect(bobs.write).toHaveBeenCalledWith("notification", JSON.stringify(payload));
  expect(carols.write).not.toHaveBeenCalled();
  unregisterClient("bob", bobs);
  unregisterClient("carol", carols);
});
