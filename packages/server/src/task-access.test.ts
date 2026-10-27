import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";
import { canDeleteTask, grants, type Grant } from "@newtab-todo/shared/task-access";

// The migrations, as production runs them, into a database of the cases below
const migrations = new URL("../drizzle/", import.meta.url);
const db = new DatabaseSync(":memory:");
for (const folder of readdirSync(migrations).sort()) {
  const migration = readFileSync(new URL(`${folder}/migration.sql`, migrations), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) db.exec(statement);
}

const rows = (query: string) => db.prepare(query).all() as Record<string, string | number | null>[];
const insert = (table: string, ...values: Record<string, string>[]) => {
  for (const row of values) {
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...Object.values(row));
  }
};

insert(
  "users",
  ...["alice", "bob", "carol", "dave"].map((id) => ({
    id,
    name: id,
    username: id,
    password_hash: "x",
  })),
);
insert(
  "categories",
  { id: "home", user_id: "alice", name: "Home" },
  { id: "gone", user_id: "alice", name: "Gone", deleted_at: "2026-10-01T00:00:00.000Z" },
);
insert(
  "category_collaborators",
  { id: "cc1", category_id: "home", user_id: "bob" },
  { id: "cc2", category_id: "gone", user_id: "carol" },
);
insert(
  "tasks",
  { id: "own", user_id: "alice", title: "Alice's own" },
  { id: "shared", user_id: "alice", title: "Shared with Bob to edit, Carol to view" },
  { id: "in-home", user_id: "bob", category_id: "home", title: "Bob's, in Alice's list" },
  { id: "in-gone", user_id: "alice", category_id: "gone", title: "In a deleted list" },
  { id: "deleted", user_id: "alice", title: "Deleted", deleted_at: "2026-10-01T00:00:00.000Z" },
  { id: "sub-of-shared", user_id: "carol", parent_id: "shared", title: "Carol's subtask" },
  { id: "sub-in-home", user_id: "alice", parent_id: "in-home", title: "Alice's subtask" },
);
insert(
  "task_shares",
  { id: "sh1", task_id: "shared", shared_with_user_id: "bob", permission: "edit" },
  { id: "sh2", task_id: "shared", shared_with_user_id: "carol", permission: "view" },
);

// What the JS is handed: the task's shares, and its list while that isn't deleted
const holder = (id: string) => {
  const [task] = rows(`SELECT * FROM tasks WHERE id = '${id}'`);
  const [list] = rows(
    `SELECT * FROM categories WHERE id = '${task.category_id}' AND deleted_at IS NULL`,
  );
  return {
    userId: String(task.user_id),
    parentId: task.parent_id as string | null,
    shares: rows(`SELECT * FROM task_shares WHERE task_id = '${id}'`).map((s) => ({
      sharedWithUserId: String(s.shared_with_user_id),
      permission: s.permission as "view" | "edit",
    })),
    category: list
      ? {
          userId: String(list.user_id),
          collaborators: rows(
            `SELECT user_id FROM category_collaborators WHERE category_id = '${list.id}'`,
          ).map((c) => ({ userId: String(c.user_id) })),
        }
      : null,
  };
};

const byUser = (a: Grant, b: Grant) => a.userId.localeCompare(b.userId);
const tasks = rows("SELECT id FROM tasks").map((t) => String(t.id));

describe("task_access and shared/task-access.ts", () => {
  test.each(tasks)("agree on %s", (id) => {
    const task = holder(id);
    // A row per way in, folded to each person's widest as the server does
    const fromView = rows(
      `SELECT user_id, max(can_edit) AS can_edit, max(can_delete) AS can_delete
       FROM task_access WHERE task_id = '${id}' GROUP BY user_id`,
    ).map((r) => ({
      userId: String(r.user_id),
      canEdit: r.can_edit === 1,
      canDelete: r.can_delete === 1,
    }));
    const fromJs = grants({ ...task, parent: task.parentId ? holder(task.parentId) : null });
    expect(fromView.sort(byUser)).toEqual(fromJs.sort(byUser));
  });
});

describe("who reaches what", () => {
  const access = (id: string) =>
    Object.fromEntries(
      rows(
        `SELECT user_id, max(can_edit) AS can_edit, max(can_delete) AS can_delete
         FROM task_access WHERE task_id = '${id}' GROUP BY user_id`,
      ).map((r) => [r.user_id, r.can_delete ? "delete" : r.can_edit ? "edit" : "view"]),
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
    for (const id of tasks) expect(access(id)).not.toHaveProperty("dave");
  });
});

test("canDeleteTask: the owner, or the parent's for a subtask", () => {
  const sub = holder("sub-of-shared");
  expect(canDeleteTask({ ...sub, parent: holder("shared") }, "alice")).toBe(true);
  expect(canDeleteTask({ ...sub, parent: holder("shared") }, "bob")).toBe(false);
});

// Built over every task, share and list, the view has to let a lookup reach each branch's index
test.each([
  ["a task", "task_id = 'own'"],
  ["a user", "user_id = 'alice'"],
])("looking up %s searches indexes and scans no table", (_, where) => {
  const plan = rows(`EXPLAIN QUERY PLAN SELECT * FROM task_access WHERE ${where}`).map((r) =>
    String(r.detail),
  );
  expect(plan.filter((step) => step.startsWith("SCAN"))).toEqual([]);
});
