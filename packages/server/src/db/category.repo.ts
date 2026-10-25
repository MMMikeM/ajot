import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db, inTransaction } from "./client";
import noteRepo from "./note.repo";
import { categories, tasks, taskShares } from "./schema";
import { BadRequestError, InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";
import { now } from "@newtab-todo/shared/iso";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { CATEGORY_TASK_ACTIONS, type CategoryTaskAction } from "@newtab-todo/shared/constants";

export type CategoryInsert = typeof categories.$inferInsert;
export type CategorySelect = typeof categories.$inferSelect;

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
export const categoryResponseSchema = createSelectSchema(categories).extend({
  user: z.object({ name: z.string() }).nullish(),
  collaborators: z.array(z.object({ user: collaboratorUserSchema.nullable() })).nullish(),
});
export const categoryInsertSchema = createInsertSchema(categories, {
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .strict();
export const categoryUpdateSchema = createUpdateSchema(categories, { updatedAt: isoDatetime })
  .required({ id: true, updatedAt: true })
  .omit({ createdAt: true })
  .strict();

const list = async (userId: string) =>
  db.query.categories.findMany({
    where: { OR: [{ userId }, { collaborators: { userId } }] },
    with: {
      user: { columns: { name: true } },
      collaborators: {
        with: { user: { columns: { id: true, name: true, username: true, avatarUrl: true } } },
      },
    },
    orderBy: { sortOrder: "asc", name: "asc" },
  });

export type CategoryWithOwner = Awaited<ReturnType<typeof list>>[number];

const findById = async (id: string) => {
  const row = await db.query.categories.findFirst({ where: { id } });
  if (!row) throw new NotFoundError("category", id);
  return row;
};

const findByIdWithCollaborators = async (id: string) => {
  const row = await db.query.categories.findFirst({
    where: { id },
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
    where: { id },
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
    .returning();
  if (!row) throw new InsertFailedError("category");
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<CategoryInsert>) => {
  const [row] = await db
    .update(categories)
    .set({ ...fields, updatedAt })
    .where(and(eq(categories.id, id), lt(categories.updatedAt, updatedAt)))
    .returning();
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
      where: { categoryId: id },
      columns: { id: true, userId: true },
      with: {
        shares: { columns: { sharedWithUserId: true } },
        subtasks: { columns: { id: true, userId: true } },
      },
    });
    if (inCategory.length > 0 && !action)
      throw new BadRequestError("Move or delete all tasks before removing this category");

    // A client from before confirmed ids were sent meant everything in the category
    const confirmed = new Set(confirmedIds ?? inCategory.map((t) => t.id));
    const doomed = action === "delete" ? inCategory.filter((t) => confirmed.has(t.id)) : [];
    const deletedIds = doomed.flatMap((t) => [t.id, ...t.subtasks.map((s) => s.id)]);
    const movedIds = inCategory.filter((t) => !doomed.includes(t)).map((t) => t.id);

    const unlinkedNotes = await noteRepo.unlinkFromTasks(tx, deletedIds);
    if (deletedIds.length > 0) await tx.delete(tasks).where(inArray(tasks.id, deletedIds));
    const movedTasks =
      movedIds.length > 0
        ? await tx
            .update(tasks)
            .set({ categoryId: null, updatedAt: now() })
            .where(inArray(tasks.id, movedIds))
            .returning()
        : [];
    const unfiledShares = await tx
      .update(taskShares)
      .set({ categoryId: null })
      .where(eq(taskShares.categoryId, id))
      .returning({ taskId: taskShares.taskId, sharedWithUserId: taskShares.sharedWithUserId });

    const [category] = await tx.delete(categories).where(eq(categories.id, id)).returning();
    if (!category) throw new NotFoundError("category", id);
    return { category, inCategory, deletedIds, movedTasks, unlinkedNotes, unfiledShares };
  });

export default {
  list,
  findById,
  findByIdWithCollaborators,
  canUse,
  insert,
  update,
  removeWithTasks,
};
