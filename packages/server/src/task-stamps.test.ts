import { describe, expect, test } from "vite-plus/test";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";

const AT = "2026-10-26T09:00:00.000Z";

describe("taskChangeStamps", () => {
  test("ticking a task done stamps when it was completed", () => {
    expect(taskChangeStamps({ status: "done" }, AT)).toEqual({ completedAt: AT });
  });

  test("unticking it clears that", () => {
    expect(taskChangeStamps({ status: "todo" }, AT)).toEqual({ completedAt: null });
  });

  test("ticking isn't an edit", () => {
    expect(taskChangeStamps({ status: "done" }, AT)).not.toHaveProperty("editedAt");
  });

  test.each(["title", "description", "dueDate"])("changing the %s is an edit", (field) => {
    expect(taskChangeStamps({ [field]: null }, AT)).toEqual({ editedAt: AT });
  });

  test("moving, reordering or assigning a task is neither", () => {
    expect(taskChangeStamps({}, AT)).toEqual({});
  });

  test("a task added already done counts as completed when added", () => {
    expect(taskChangeStamps({ status: "done", title: "Milk" }, AT)).toEqual({
      completedAt: AT,
      editedAt: AT,
    });
  });
});
