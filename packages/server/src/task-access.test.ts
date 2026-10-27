import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { describe, expect, test } from "vite-plus/test";
import { canDeleteTask, grants, widest, type Grant } from "@newtab-todo/shared/task-access";
import { migrate } from "./db/migrator";
import { categories, categoryCollaborators, tasks, taskShares, users } from "./db/schema";

// The migrations, applied as migrate.ts applies them, into a database of the cases below
const sqlite = new DatabaseSync(":memory:");
const db = drizzle({ client: sqlite });
await migrate(db, fileURLToPath(new URL("../drizzle", import.meta.url)));

const deletedAt = "2026-10-01T00:00:00.000Z";
const lists = [
  { id: "home", userId: "alice", name: "Home" },
  { id: "gone", userId: "alice", name: "Gone", deletedAt },
];
const collaborators = [
  { id: "cc1", categoryId: "home", userId: "bob" },
  { id: "cc2", categoryId: "gone", userId: "carol" },
];
const taskRows = [
  { id: "own", userId: "alice", title: "Alice's own" },
  { id: "shared", userId: "alice", title: "Shared with Bob to edit, Carol to view" },
  { id: "in-home", userId: "bob", categoryId: "home", title: "Bob's, in Alice's list" },
  { id: "in-gone", userId: "alice", categoryId: "gone", title: "In a deleted list" },
  { id: "deleted", userId: "alice", title: "Deleted", deletedAt },
  { id: "sub-of-shared", userId: "carol", parentId: "shared", title: "Carol's subtask" },
  { id: "sub-in-home", userId: "alice", parentId: "in-home", title: "Alice's subtask" },
];
const shares = [
  { id: "sh1", taskId: "shared", sharedWithUserId: "bob", permission: "edit" as const },
  { id: "sh2", taskId: "shared", sharedWithUserId: "carol", permission: "view" as const },
];

const people = ["alice", "bob", "carol", "dave"];
db.insert(users)
  .values(people.map((id) => ({ id, name: id, username: id, passwordHash: "x" })))
  .run();
db.insert(categories).values(lists).run();
db.insert(categoryCollaborators).values(collaborators).run();
db.insert(tasks).values(taskRows).run();
db.insert(taskShares).values(shares).run();

// What the JS is handed for a task: its shares, and its list while that isn't deleted
const holder = (id: string) => {
  const task = taskRows.find((t) => t.id === id)!;
  const list = lists.find((l) => l.id === task.categoryId && !l.deletedAt);
  return {
    userId: task.userId,
    parentId: task.parentId,
    shares: shares.filter((s) => s.taskId === id),
    category: list && {
      userId: list.userId,
      collaborators: collaborators.filter((c) => c.categoryId === list.id),
    },
  };
};

const query = (sql: string) => sqlite.prepare(sql).all() as Record<string, string | number>[];

/** The view's rows for a task, folded to each person's widest, as the server does. */
const viewGrants = (id: string): Grant[] =>
  widest(
    query(`SELECT * FROM task_access WHERE task_id = '${id}'`).map((r) => ({
      userId: String(r.user_id),
      canEdit: r.can_edit === 1,
      canDelete: r.can_delete === 1,
    })),
  );

const byUser = (a: Grant, b: Grant) => a.userId.localeCompare(b.userId);

describe("task_access and shared/task-access.ts", () => {
  test.each(taskRows.map((t) => t.id))("agree on %s", (id) => {
    const task = holder(id);
    const fromJs = grants({ ...task, parent: task.parentId ? holder(task.parentId) : null });
    expect(viewGrants(id).sort(byUser)).toEqual(fromJs.sort(byUser));
  });
});

describe("who reaches what", () => {
  const access = (id: string) =>
    Object.fromEntries(
      viewGrants(id).map((g) => [g.userId, g.canDelete ? "delete" : g.canEdit ? "edit" : "view"]),
    );

  test("an owner deletes; an edit share edits; a view share views", () => {
    expect(access("shared")).toEqual({ alice: "delete", bob: "edit", carol: "view" });
  });

  test("a list's owner and collaborators edit a task in it, and only its owner deletes it", () => {
    expect(access("in-home")).toEqual({ alice: "edit", bob: "delete" });
  });

  test("a deleted list reaches no one", () => {
    expect(access("in-gone")).toEqual({ alice: "delete" });
  });

  test("a deleted task keeps its access, for the restore", () => {
    expect(access("deleted")).toEqual({ alice: "delete" });
  });

  test("a subtask goes with its parent, and its own owner deletes it", () => {
    expect(access("sub-of-shared")).toEqual({ alice: "delete", bob: "edit", carol: "delete" });
    expect(access("sub-in-home")).toEqual({ alice: "delete", bob: "delete" });
  });

  test("not a stranger", () => {
    for (const { id } of taskRows) expect(access(id)).not.toHaveProperty("dave");
  });
});

test("canDeleteTask: the owner, or the parent's for a subtask", () => {
  const sub = holder("sub-of-shared");
  expect(canDeleteTask({ ...sub, parent: holder("shared") }, "alice")).toBe(true);
  expect(canDeleteTask({ ...sub, parent: holder("shared") }, "bob")).toBe(false);
});

// Built over every task, share and list, the view has to let each lookup the server makes reach
// each branch's index
test.each([
  ["a task", "SELECT * FROM task_access WHERE task_id = 'own'"],
  ["a user", "SELECT * FROM task_access WHERE user_id = 'alice'"],
  [
    "a task with its row",
    "SELECT * FROM task_access a JOIN tasks t ON t.id = a.task_id WHERE a.task_id = 'own'",
  ],
  [
    "a user's task list",
    "SELECT * FROM tasks WHERE id IN (SELECT task_id FROM task_access WHERE user_id = 'alice')",
  ],
])("looking up %s searches indexes and scans no table", (_, sql) => {
  const steps = query(`EXPLAIN QUERY PLAN ${sql}`).map((r) => String(r.detail));
  expect(steps.filter((step) => step.startsWith("SCAN"))).toEqual([]);
});
