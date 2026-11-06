import { describe, expect, test } from "vite-plus/test";
import { IdTakenError, InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";

describe("errors a person may be shown", () => {
  test.each([
    [new NotFoundError("task", "tsk_123"), 404],
    [new NotFoundError("contact", "bob"), 404],
    [new StaleUpdateError("task", "tsk_123"), 409],
    [new IdTakenError("task", "tsk_123"), 409],
    [new InsertFailedError("task share"), 500],
  ])("%#: say what happened without ids", (err, status) => {
    expect(err.status).toBe(status);
    expect(err.message).not.toMatch(/tsk_123|bob/);
  });
});
