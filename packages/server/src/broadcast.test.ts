import { expect, test, vi } from "vite-plus/test";
import { notifyMutation, registerClient, unregisterClient, writeNotification } from "./broadcast";

vi.mock("./push-queue", () => ({ queueChanges: vi.fn() }));

const stream = () => ({ write: vi.fn(), close: vi.fn() });

test("one account's streams past a hundred close its oldest", () => {
  const streams = Array.from({ length: 101 }, stream);
  for (const writer of streams) registerClient("alice", writer);

  notifyMutation({ model: "tasks", action: "update", data: { id: "t" } }, ["alice"]);

  const [oldest, ...rest] = streams;
  expect(oldest!.close).toHaveBeenCalled();
  expect(oldest!.write).not.toHaveBeenCalled();
  for (const writer of rest) {
    expect(writer.close).not.toHaveBeenCalled();
    expect(writer.write).toHaveBeenCalledTimes(1);
  }
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
