import { describe, expect, test } from "vite-plus/test";
import { IdTakenError, InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";

describe("errors a person may be shown", () => {
  test.each([
    [new NotFoundError("task", "tsk_123"), 404, "That task no longer exists."],
    [new NotFoundError("username", "bob"), 404, "No one here has that username."],
    [new StaleUpdateError("task", "tsk_123"), 409, expect.not.stringContaining("tsk_123")],
    [new IdTakenError("task", "tsk_123"), 409, "That couldn't be saved. Try adding it again."],
    [new InsertFailedError("task share"), 500, expect.not.stringMatching(/row|share/)],
  ])("%#: say what happened without ids, keeping them for the log", (err, status, message) => {
    expect(err.status).toBe(status);
    expect(err.message).toEqual(message);
    expect(err.message).not.toMatch(/tsk_123|bob/);
  });

  test("keep the id for the server's log", () => {
    expect(new NotFoundError("task", "tsk_123").detail).toBe("task not found: tsk_123");
  });
});
