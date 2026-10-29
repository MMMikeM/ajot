import { and, eq, getColumns, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { keptSortOrder } from "./sort-key";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { categories, taskAccess, tasks, users } from "./schema";
import * as taskShareRepo from "./task-share.repo";
import { IdTakenError, NotFoundError, StaleUpdateError } from "./errors";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { now } from "@newtab-todo/shared/iso";
import { MAX_SHORT, MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { limited, limitedId } from "./field-limits";
import { notAfterNow, stampsNotAfterNow } from "./stamps";

export type Insert = typeof tasks.$inferInsert;

export const idSchema = createSelectSchema(tasks, { id: limitedId }).pick({ id: true });
export const responseSchema = createSelectSchema(tasks).omit({
  live: true,
  topLevel: true,
  hasParent: true,
});

// These only hold the database's rules about subtasks, so no read or write sends them
const hidden = { live: false, topLevel: false, hasParent: false } as const;
const {
  live: _live,
  topLevel: _topLevel,
  hasParent: _hasParent,
  ...sentColumns
} = getColumns(tasks);

const sharedWithUserSchema = createSelectSchema(users).pick({
  id: true,
  name: true,
  username: true,
});

export const listItemSchema = responseSchema.extend({
  user: z.object({ id: z.string(), name: z.string() }),
  subtasks: z.array(responseSchema),
  shares: z.array(
    taskShareRepo.responseSchema.extend({
      sharedWithUser: sharedWithUserSchema,
    }),
  ),
  assignee: sharedWithUserSchema.nullable(),
  sentBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
const limitedFields = {
  id: limitedId,
  userId: limitedId,
  categoryId: limitedId,
  assigneeId: limitedId,
  parentId: limitedId,
  title: limited("A task's title", MAX_TITLE),
  description: limited("A task's description", MAX_TEXT),
  dueDate: limited("A due date", MAX_SHORT),
  editedAt: limited("An edit's time", MAX_SHORT),
  completedAt: limited("A completion's time", MAX_SHORT),
};
export const insertSchema = createInsertSchema(tasks, {
  ...limitedFields,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .omit({ deletedAt: true, sentById: true });
// The fields a client may change, so a column added later isn't editable until it's listed. Its
// owner and parent are fixed: a task taken, planted in someone's Inbox or hung under theirs
// would be theirs. Deleting goes through DELETE; an update can only bring a deleted task back.
export const updateSchema = createUpdateSchema(tasks, {
  ...limitedFields,
  updatedAt: isoDatetime,
})
  .pick({
    id: true,
    updatedAt: true,
    title: true,
    description: true,
    status: true,
    dueDate: true,
    sortOrder: true,
    categoryId: true,
    assigneeId: true,
    editedAt: true,
    completedAt: true,
  })
  .required({ id: true, updatedAt: true })
  .extend({ deletedAt: z.null().optional() })
  .strict();

export const list = async (userId: string) =>
  db.query.tasks.findMany({
    where: {
      deletedAt: { isNull: true },
      RAW: (task) =>
        inArray(
          task.id,
          db
            .select({ id: taskAccess.taskId })
            .from(taskAccess)
            .where(eq(taskAccess.userId, userId)),
        ),
    },
    columns: hidden,
    with: {
      user: { columns: { id: true, name: true } },
      subtasks: { where: { deletedAt: { isNull: true } }, columns: hidden },
      shares: {
        with: {
          sharedWithUser: { columns: { id: true, name: true, username: true } },
        },
      },
      assignee: { columns: { id: true, name: true, username: true } },
      sentBy: { columns: { id: true, name: true } },
    },
    orderBy: { sortOrder: "asc", createdAt: "asc" },
  });

export const findById = async (id: string, { deleted = false } = {}) => {
  const row = await db.query.tasks.findFirst({
    where: deleted ? { id } : { id, deletedAt: { isNull: true } },
    columns: hidden,
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

/** A row per way in. */
export const accessTo = async (taskIds: string[]) =>
  taskIds.length === 0
    ? []
    : db.select().from(taskAccess).where(inArray(taskAccess.taskId, taskIds));

export type AccessRow = Awaited<ReturnType<typeof accessTo>>[number];

// Filtered on the view's task_id, so each branch of task_access is an index lookup
export const findWithAccess = async (id: string, { deleted = false } = {}) => {
  const rows = await db
    .select({
      task: sentColumns,
      taskId: taskAccess.taskId,
      userId: taskAccess.userId,
      canEdit: taskAccess.canEdit,
      canDelete: taskAccess.canDelete,
    })
    .from(taskAccess)
    .innerJoin(tasks, eq(tasks.id, taskAccess.taskId))
    .where(
      deleted ? eq(taskAccess.taskId, id) : and(eq(taskAccess.taskId, id), isNull(tasks.deletedAt)),
    );
  return { task: rows[0]?.task, access: rows.map(({ task: _task, ...access }) => access) };
};

// The stamps a client sends that later writes compare against
const STAMPS = ["updatedAt", "editedAt", "completedAt"] as const;

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it.
// Re-inserting a deleted task restores it, since the conflict update clears deletedAt.
// An id someone else's task already has updates nothing, so it returns nothing and restores nothing.
export const insert = async (data: Insert) => {
  const [row] = await db
    .insert(tasks)
    .values({ ...stampsNotAfterNow(data, [...STAMPS]), sortOrder: keptSortOrder(data.sortOrder) })
    .onConflictDoUpdate({
      target: tasks.id,
      set: { updatedAt: sql`${tasks.updatedAt}`, deletedAt: sql`null` },
      setWhere: eq(tasks.userId, data.userId),
    })
    .returning(sentColumns);
  if (!row) throw new IdTakenError("task", data.id);
  return row;
};

// A task sent to someone, which they own. Nothing retries a send with the same id, so any id
// already taken is a conflict, and the sender never gets back a task of the recipient's.
export const insertSent = async (data: Insert) => {
  const [row] = await db
    .insert(tasks)
    .values(stampsNotAfterNow(data, [...STAMPS]))
    .onConflictDoNothing()
    .returning(sentColumns);
  if (!row) throw new IdTakenError("task", data.id);
  return row;
};

export const update = async (id: string, updatedAt: string, fields: Partial<Insert>) => {
  const at = notAfterNow(updatedAt);
  const [row] = await db
    .update(tasks)
    .set({
      ...stampsNotAfterNow(fields, [...STAMPS]),
      sortOrder: keptSortOrder(fields.sortOrder),
      updatedAt: at,
    })
    .where(and(eq(tasks.id, id), lt(tasks.updatedAt, at)))
    .returning(sentColumns);
  if (!row) throw new StaleUpdateError("task", id);
  return row;
};

// Leaves updatedAt, the sync clock, alone: a note or subtask changing must not beat a pending
// edit to the task itself. Undefined when the task was already edited later than `at`.
export const markEdited = async (id: string, editedAt: string) => {
  const at = notAfterNow(editedAt);
  const [row] = await db
    .update(tasks)
    .set({ editedAt: at })
    .where(
      and(
        eq(tasks.id, id),
        isNull(tasks.deletedAt),
        or(isNull(tasks.editedAt), lt(tasks.editedAt, at)),
      ),
    )
    .returning(sentColumns);
  return row;
};

// After the user's other top-level tasks, where the app puts a task they add themselves
export const nextSortOrder = async (userId: string) => {
  const last = await db.query.tasks.findFirst({
    where: { userId, parentId: { isNull: true }, sortOrder: { isNotNull: true } },
    columns: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  return keyAfter([last?.sortOrder]);
};

// Bumping updatedAt makes the delete win over older offline edits
export const remove = async (id: string) => {
  const at = now();
  const rows = await db
    .update(tasks)
    .set({ deletedAt: at, updatedAt: at })
    .where(and(or(eq(tasks.id, id), eq(tasks.parentId, id)), isNull(tasks.deletedAt)))
    .returning(sentColumns);
  const task = rows.find((row) => row.id === id);
  if (!task) throw new NotFoundError("task", id);
  return { task, subtaskIds: rows.filter((row) => row.id !== id).map((row) => row.id) };
};

// Null when the task's list has been deleted since, so the task comes back in the Inbox
const liveCategoryId = sql<string | null>`(select ${categories.id} from ${categories}
  where ${categories.id} = ${tasks.categoryId} and ${categories.deletedAt} is null)`;

/**
 * Skips update's stale check: the delete was stamped by the server's clock and the restore by the
 * device's, and a restore always comes after the delete it undoes.
 */
export const restore = async (id: string, updatedAt: string) => {
  const [row] = await db
    .update(tasks)
    .set({
      deletedAt: null,
      categoryId: liveCategoryId,
      updatedAt: sql`max(${tasks.updatedAt}, ${notAfterNow(updatedAt)})`,
    })
    .where(eq(tasks.id, id))
    .returning(sentColumns);
  if (!row) throw new NotFoundError("task", id);
  return row;
};

const listItemWith = {
  user: { columns: { id: true, name: true } },
  subtasks: { where: { deletedAt: { isNull: true } }, columns: hidden },
  shares: {
    with: {
      sharedWithUser: { columns: { id: true, name: true, username: true } },
    },
  },
  assignee: { columns: { id: true, name: true, username: true } },
  sentBy: { columns: { id: true, name: true } },
} as const;

export const findListItem = async (id: string) => {
  const row = await db.query.tasks.findFirst({
    where: { id, deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

export const findListItemWithSubtasks = async (id: string) =>
  db.query.tasks.findMany({
    where: { OR: [{ id }, { parentId: id }], deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });

export const findListItems = async (ids: string[]) => {
  if (ids.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: ids }, deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });
};

export type TaskWithRelations = Awaited<ReturnType<typeof list>>[number];

export const findOverdue = async (beforeDate: string) =>
  db.query.tasks.findMany({
    where: {
      dueDate: { lt: beforeDate },
      status: { in: ["todo", "in_progress"] },
      deletedAt: { isNull: true },
    },
    columns: { id: true, title: true, dueDate: true, userId: true },
  });
