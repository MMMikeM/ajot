import { expect, test, vi } from "vite-plus/test";
import { notifyMutation, registerClient } from "./broadcast";

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
