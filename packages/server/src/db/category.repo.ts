import { and, eq, getColumns, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db, inTransaction } from "./client";
import { categories, tasks, taskShares, type CategoryDeletion } from "./schema";
import {
  BadRequestError,
  ForbiddenError,
  InsertFailedError,
  NotFoundError,
  StaleUpdateError,
} from "./errors";
import { now } from "@newtab-todo/shared/iso";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { CATEGORY_TASK_ACTIONS, type CategoryTaskAction } from "@newtab-todo/shared/constants";

export type CategoryInsert = typeof categories.$inferInsert;

export const categorySelectSchema = createSelectSchema(categories).pick({ id: true });
export const categoryDeleteSchema = categorySelectSchema.extend({
  tasks: z.enum(CATEGORY_TASK_ACTIONS).optional(),
  /** The top-level tasks the user was shown; only these can be deleted */
  taskIds: z.array(z.string()).optional(),
});
const collaboratorUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
});

// list() includes user + collaborators; insert/update/delete return flat rows without them.
// nullish() allows these keys to be absent so all routes satisfy this schema.
export const categoryResponseSchema = createSelectSchema(categories)
  .omit({ deletedAt: true, deletion: true })
  .extend({
    user: z.object({ name: z.string() }).nullish(),
    collaborators: z.array(z.object({ user: collaboratorUserSchema.nullable() })).nullish(),
  });
export const categoryInsertSchema = createInsertSchema(categories, {
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .omit({ deletedAt: true, deletion: true })
  .strict();
export const categoryUpdateSchema = createUpdateSchema(categories, { updatedAt: isoDatetime })
  .required({ id: true, updatedAt: true })
  .omit({ createdAt: true, deletedAt: true, deletion: true })
  .strict();

// What a deleted list keeps is only for the server's Undo, so no read or write sends it
const hidden = { deletedAt: false, deletion: false } as const;
const { deletedAt: _deletedAt, deletion: _deletion, ...sentColumns } = getColumns(categories);
const live = { deletedAt: { isNull: true } } as const;

const list = async (userId: string) =>
  db.query.categories.findMany({
    where: { ...live, OR: [{ userId }, { collaborators: { userId } }] },
    columns: hidden,
    with: {
      user: { columns: { name: true } },
      collaborators: {
        with: { user: { columns: { id: true, name: true, username: true, avatarUrl: true } } },
      },
    },
    orderBy: { sortOrder: "asc", name: "asc" },
  });

export type CategoryWithOwner = Awaited<ReturnType<typeof list>>[number];

/** The lists in the shape `list` sends, for broadcasting ones that are back. */
const listByIds = async (ids: string[]) => {
  if (ids.length === 0) return [];
  return db.query.categories.findMany({
    where: { ...live, id: { in: ids } },
    columns: hidden,
    with: {
      user: { columns: { name: true } },
      collaborators: {
        with: { user: { columns: { id: true, name: true, username: true, avatarUrl: true } } },
      },
    },
  });
};

const findById = async (id: string) => {
  const row = await db.query.categories.findFirst({ where: { ...live, id }, columns: hidden });
  if (!row) throw new NotFoundError("category", id);
  return row;
};

const findByIdWithCollaborators = async (id: string) => {
  const row = await db.query.categories.findFirst({
    where: { ...live, id },
    columns: hidden,
    with: {
      collaborators: {
        with: { user: { columns: { id: true, name: true, username: true, avatarUrl: true } } },
      },
    },
  });
  if (!row) throw new NotFoundError("category", id);
  return row;
};

/** Whether the user may file tasks in this list: they own it or collaborate on it. */
const canUse = async (id: string, userId: string) => {
  const row = await db.query.categories.findFirst({
    where: { ...live, id },
    columns: { userId: true },
    with: { collaborators: { columns: { userId: true } } },
  });
  return !!row && (row.userId === userId || row.collaborators.some((c) => c.userId === userId));
};

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it
const insert = async (data: CategoryInsert) => {
  const [row] = await db
    .insert(categories)
    .values(data)
    .onConflictDoUpdate({ target: categories.id, set: { updatedAt: sql`${categories.updatedAt}` } })
    .returning(sentColumns);
  if (!row) throw new InsertFailedError("category");
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<CategoryInsert>) => {
  const [row] = await db
    .update(categories)
    .set({ ...fields, updatedAt })
    .where(and(eq(categories.id, id), lt(categories.updatedAt, updatedAt)))
    .returning(sentColumns);
  if (!row) throw new StaleUpdateError("category", id);
  return row;
};

// Reads and writes in one transaction, so a task moved out meanwhile is left alone, and one
// added meanwhile goes to the Inbox rather than being deleted unseen
const removeWithTasks = async (
  id: string,
  action: CategoryTaskAction | undefined,
  confirmedIds: string[] | undefined,
) =>
  inTransaction(async (tx) => {
    const inCategory = await tx.query.tasks.findMany({
      where: { categoryId: id, deletedAt: { isNull: true } },
      columns: { id: true, userId: true },
      with: {
        shares: { columns: { sharedWithUserId: true } },
        subtasks: { where: { deletedAt: { isNull: true } }, columns: { id: true, userId: true } },
      },
    });
    if (inCategory.length > 0 && !action)
      throw new BadRequestError("Move or delete this list's tasks first.");

    // A client from before confirmed ids were sent meant everything in the category
    const confirmed = new Set(confirmedIds ?? inCategory.map((t) => t.id));
    const doomed = action === "delete" ? inCategory.filter((t) => confirmed.has(t.id)) : [];
    const deletedIds = doomed.flatMap((t) => [t.id, ...t.subtasks.map((s) => s.id)]);
    const movedIds = inCategory.filter((t) => !doomed.includes(t)).map((t) => t.id);

    // Hidden, as deleting one task does, and stamped with the list's own deletedAt, so Undo can
    // tell them from tasks deleted on their own
    const at = now();
    if (deletedIds.length > 0)
      await tx
        .update(tasks)
        .set({ deletedAt: at, updatedAt: at })
        .where(inArray(tasks.id, deletedIds));
    const movedTasks =
      movedIds.length > 0
        ? await tx
            .update(tasks)
            .set({ categoryId: null, updatedAt: at })
            .where(inArray(tasks.id, movedIds))
            .returning()
        : [];
    const unfiledShares = await tx
      .update(taskShares)
      .set({ categoryId: null })
      .where(eq(taskShares.categoryId, id))
      .returning({ taskId: taskShares.taskId, sharedWithUserId: taskShares.sharedWithUserId });

    const deletion: CategoryDeletion = {
      deletedTaskIds: deletedIds,
      movedTaskIds: movedIds,
      unfiledShares,
    };
    const [category] = await tx
      .update(categories)
      .set({ deletedAt: at, updatedAt: at, deletion })
      .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
      .returning(sentColumns);
    if (!category) throw new NotFoundError("category", id);
    return { category, inCategory, deletedIds, movedTasks, unfiledShares };
  });

/**
 * Undoes removeWithTasks for the list's owner. A task changed since stays where it went: moved
 * back only from the Inbox, refiled only if still unfiled. A task or share of someone no longer
 * on the list goes to their Inbox, where they can still see it. A list that isn't deleted, as
 * when a restore is replayed after a lost response, comes back unchanged.
 */
const restore = async (id: string, userId: string) => {
  const result = await inTransaction(async (tx) => {
    const found = await tx.query.categories.findFirst({
      where: { id },
      with: { collaborators: { columns: { userId: true } } },
    });
    if (!found) throw new NotFoundError("category", id);
    if (found.userId !== userId) throw new ForbiddenError("Not authorized");
    const memberIds = [found.userId, ...found.collaborators.map((c) => c.userId)];
    const nothing = { restoredIds: [], movedBack: [], refiled: [], memberIds };
    if (!found.deletedAt) return nothing;

    const { deletedTaskIds, movedTaskIds, unfiledShares } = found.deletion ?? {
      deletedTaskIds: [],
      movedTaskIds: [],
      unfiledShares: [],
    };
    const at = now();
    await tx
      .update(categories)
      .set({ deletedAt: null, deletion: null, updatedAt: at })
      .where(eq(categories.id, id));

    const restored =
      deletedTaskIds.length > 0
        ? await tx
            .update(tasks)
            .set({ deletedAt: null, updatedAt: at })
            .where(and(inArray(tasks.id, deletedTaskIds), eq(tasks.deletedAt, found.deletedAt)))
            .returning({ id: tasks.id })
        : [];
    const restoredIds = restored.map((t) => t.id);
    if (restoredIds.length > 0)
      await tx
        .update(tasks)
        .set({ categoryId: null })
        .where(
          and(
            inArray(tasks.id, restoredIds),
            eq(tasks.categoryId, id),
            notInArray(tasks.userId, memberIds),
          ),
        );

    const movedBack =
      movedTaskIds.length > 0
        ? await tx
            .update(tasks)
            .set({ categoryId: id, updatedAt: at })
            .where(
              and(
                inArray(tasks.id, movedTaskIds),
                isNull(tasks.categoryId),
                isNull(tasks.deletedAt),
                inArray(tasks.userId, memberIds),
              ),
            )
            .returning()
        : [];

    const refilable = unfiledShares.filter((s) => memberIds.includes(s.sharedWithUserId));
    const refiled =
      refilable.length > 0
        ? await tx
            .update(taskShares)
            .set({ categoryId: id })
            .where(
              and(
                isNull(taskShares.categoryId),
                or(
                  ...refilable.map((s) =>
                    and(
                      eq(taskShares.taskId, s.taskId),
                      eq(taskShares.sharedWithUserId, s.sharedWithUserId),
                    ),
                  ),
                ),
              ),
            )
            .returning({ taskId: taskShares.taskId, sharedWithUserId: taskShares.sharedWithUserId })
        : [];

    return { restoredIds, movedBack, refiled, memberIds };
  });
  const [category] = await listByIds([id]);
  if (!category) throw new NotFoundError("category", id);
  return { category, ...result };
};

export default {
  list,
  listByIds,
  findById,
  findByIdWithCollaborators,
  canUse,
  insert,
  update,
  removeWithTasks,
  restore,
};
