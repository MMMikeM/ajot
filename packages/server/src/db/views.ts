// The views, which migrate.ts creates from here on every run (see migrator.ts), so drizzle-kit is
// told they're existing. Kept apart from schema.ts, whose relative imports plain node can't
// resolve.
import { getViewName, sql, type SQL } from "drizzle-orm";
import { integer, sqliteView, text } from "drizzle-orm/sqlite-core";
import type { AccessPath } from "@newtab-todo/shared/task-access";

/**
 * Who's in a list: its owner and its collaborators, while it isn't deleted. `UNION ALL`, not
 * `UNION`: de-duplicating would stop a filter on the list or the user reaching inside, so the
 * whole view would be built for every lookup.
 */
export const listMembers = sqliteView("list_members", {
  listId: text("list_id").notNull(),
  userId: text("user_id").notNull(),
}).existing();

const listMembersQuery = sql`
  SELECT id AS list_id, user_id FROM categories WHERE deleted_at IS NULL
  UNION ALL
  SELECT cc.category_id AS list_id, cc.user_id FROM category_collaborators cc
  JOIN categories c ON c.id = cc.category_id AND c.deleted_at IS NULL`;

// Each path in shared/task-access.ts, as rows of (the task holding it, who, how far)
const holderAccess = {
  owner: sql`SELECT id AS holder_id, user_id, 1 AS can_edit, 1 AS can_delete FROM tasks`,
  share: sql`SELECT task_id AS holder_id, shared_with_user_id AS user_id,
    permission = 'edit' AS can_edit, 0 AS can_delete FROM task_shares`,
  list: sql`SELECT t.id AS holder_id, m.user_id, 1 AS can_edit, 0 AS can_delete
    FROM tasks t JOIN list_members m ON m.list_id = t.category_id`,
} satisfies Record<AccessPath, SQL>;

const reachedDirectly = (path: SQL) =>
  sql`SELECT h.holder_id AS task_id, h.user_id, h.can_edit, h.can_delete FROM (${path}) h`;
const reachedThroughParent = (path: SQL) =>
  sql`SELECT c.id AS task_id, h.user_id, h.can_edit, h.can_delete
    FROM tasks c JOIN (${path}) h ON h.holder_id = c.parent_id`;

/**
 * Who can reach each task, and how far: the one place the server asks. One row per way in, so a
 * person can have several for one task; callers take the widest. It isn't grouped here, since a
 * GROUP BY would stop a filter on the task or the user reaching each branch and its index.
 * Deleted tasks are included, for the restore.
 */
export const taskAccess = sqliteView("task_access", {
  taskId: text("task_id").notNull(),
  userId: text("user_id").notNull(),
  canEdit: integer("can_edit", { mode: "boolean" }).notNull(),
  canDelete: integer("can_delete", { mode: "boolean" }).notNull(),
}).existing();

const taskAccessQuery = sql.join(
  [
    ...Object.values(holderAccess).map(reachedDirectly),
    ...Object.values(holderAccess).map(reachedThroughParent),
  ],
  sql` UNION ALL `,
);

/** Each view's SQL, a view after the ones it reads. */
export const viewDefinitions = [
  { name: getViewName(listMembers), query: listMembersQuery },
  { name: getViewName(taskAccess), query: taskAccessQuery },
];
