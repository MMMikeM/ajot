import { describe, expect, test } from "vite-plus/test";
import { canEditTask, canSeeTask } from "./task-access";

const owner = "alice";
const other = "bob";

const task = (extra: Partial<Parameters<typeof canEditTask>[0]> = {}) => ({
  userId: owner,
  shares: [],
  category: null,
  ...extra,
});

const viewShare = { sharedWithUserId: other, permission: "view" as const };
const editShare = { sharedWithUserId: other, permission: "edit" as const };
const sharedList = { collaborators: [{ userId: other }] };

describe("canEditTask", () => {
  test("the owner", () => {
    expect(canEditTask(task(), owner)).toBe(true);
  });

  test("not a stranger", () => {
    expect(canEditTask(task(), other)).toBe(false);
  });

  test("an edit share's recipient", () => {
    expect(canEditTask(task({ shares: [editShare] }), other)).toBe(true);
  });

  test("not a view share's recipient", () => {
    expect(canEditTask(task({ shares: [viewShare] }), other)).toBe(false);
  });

  test("a collaborator on the task's list", () => {
    expect(canEditTask(task({ category: sharedList }), other)).toBe(true);
  });

  test("a subtask, through its parent", () => {
    const sub = (parent: ReturnType<typeof task>) => task({ parent });
    expect(canEditTask(sub(task({ shares: [editShare] })), other)).toBe(true);
    expect(canEditTask(sub(task({ category: sharedList })), other)).toBe(true);
    expect(canEditTask(sub(task({ shares: [viewShare] })), other)).toBe(false);
    expect(canEditTask(sub(task()), other)).toBe(false);
  });

  test("a subtask you added under a task shared with you", () => {
    expect(canEditTask(task({ userId: other, parent: task({ shares: [viewShare] }) }), other)).toBe(
      true,
    );
  });
});

describe("canSeeTask", () => {
  test("a view share's recipient", () => {
    expect(canSeeTask(task({ shares: [viewShare] }), other)).toBe(true);
  });

  test("a subtask of a task shared with you to view", () => {
    expect(canSeeTask(task({ parent: task({ shares: [viewShare] }) }), other)).toBe(true);
  });

  test("not a stranger", () => {
    expect(canSeeTask(task(), other)).toBe(false);
    expect(canSeeTask(task({ parent: task() }), other)).toBe(false);
  });
});
