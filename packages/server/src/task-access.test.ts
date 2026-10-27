import { describe, expect, test } from "vite-plus/test";
import { audience, canDeleteTask, canEditTask, canSeeTask } from "./task-access";

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
const sharedList = { userId: owner, collaborators: [{ userId: other }] };

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

describe("canDeleteTask", () => {
  test("the owner, or the parent's for a subtask", () => {
    expect(canDeleteTask(task(), owner)).toBe(true);
    expect(canDeleteTask(task({ userId: other, parent: task() }), owner)).toBe(true);
  });

  test("not an edit share's recipient or a collaborator", () => {
    expect(canDeleteTask(task({ shares: [editShare] }), other)).toBe(false);
    expect(canDeleteTask(task({ category: sharedList }), other)).toBe(false);
  });
});

describe("audience", () => {
  test("the owner, whoever it's shared with and the list's people, once each", () => {
    const carol = { sharedWithUserId: "carol", permission: "view" as const };
    expect(audience(task({ shares: [editShare, carol], category: sharedList }))).toEqual([
      owner,
      other,
      "carol",
    ]);
  });

  test("a subtask reaches everyone its parent does", () => {
    expect(audience(task({ userId: other, parent: task({ shares: [viewShare] }) }))).toEqual([
      other,
      owner,
    ]);
  });
});

describe("a list's owner", () => {
  // Bob added this to Alice's list, which he collaborates on
  const added = task({ userId: other, category: sharedList });

  test("sees and edits a task someone else added to their list", () => {
    expect(canSeeTask(added, owner)).toBe(true);
    expect(canEditTask(added, owner)).toBe(true);
    expect(audience(added)).toContain(owner);
  });

  test("but doesn't delete it", () => {
    expect(canDeleteTask(added, owner)).toBe(false);
  });
});
