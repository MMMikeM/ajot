import { and, eq, getColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { z } from "@hono/zod-openapi";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { MAX_FILE_NAME, MAX_SHORT } from "@newtab-todo/shared/field-limits";
import { db } from "./client";
import { attachments, taskAccess } from "./schema";
import { limited, limitedId } from "./field-limits";
import { stampsNotAfterNow } from "./stamps";

export type Insert = typeof attachments.$inferInsert;
export type Attachment = Omit<typeof attachments.$inferSelect, "purgedAt">;

const columns = getColumns(attachments);
const { purgedAt: _purgedAt, ...sentColumns } = columns;

export const responseSchema = createSelectSchema(attachments).omit({ purgedAt: true });
// Its id is in its bucket keys, so nothing in it may change the URL they're part of
const keySafeId = (schema: z.ZodString) => limitedId(schema).regex(/^[A-Za-z0-9_-]+$/);

export const insertSchema = createInsertSchema(attachments, {
  id: keySafeId,
  taskId: limitedId,
  name: limited("A file's name", MAX_FILE_NAME),
  mimeType: (schema) => schema.max(MAX_SHORT),
  thumbhash: (schema) => schema.max(MAX_SHORT),
  size: (schema) => schema.int().positive(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .pick({
    id: true,
    taskId: true,
    name: true,
    mimeType: true,
    size: true,
    thumbhash: true,
    hasThumb: true,
    createdAt: true,
    updatedAt: true,
  })
  .required({ id: true, createdAt: true, updatedAt: true })
  .strict();
export const idSchema = createSelectSchema(attachments, { id: keySafeId }).pick({
  id: true,
});

/** Everyone who sees the task sees one once it's uploaded; until then, only its uploader. */
const visibleTo = (userId: string, ids?: string[]) =>
  db.query.attachments.findMany({
    where: {
      ...(ids && { id: { in: ids } }),
      deletedAt: { isNull: true },
      task: { deletedAt: { isNull: true } },
      OR: [{ uploadedAt: { isNotNull: true } }, { uploaderId: userId }],
      RAW: (row) =>
        inArray(
          row.taskId,
          db
            .select({ id: taskAccess.taskId })
            .from(taskAccess)
            .where(eq(taskAccess.userId, userId)),
        ),
    },
    columns: { purgedAt: false },
  });

export const list = async (userId: string) => visibleTo(userId);

export const listByIds = async (ids: string[], userId: string) =>
  ids.length === 0 ? [] : visibleTo(userId, ids);

export const find = async (id: string) => db.query.attachments.findFirst({ where: { id } });

export const uploadedOf = async (taskIds: string[]) =>
  taskIds.length === 0
    ? []
    : db.query.attachments.findMany({
        where: {
          taskId: { in: taskIds },
          uploadedAt: { isNotNull: true },
          deletedAt: { isNull: true },
        },
        columns: { purgedAt: false },
      });

/** Every byte that may still be stored, which only the purge frees. */
const usageOf = (uploaderId: string) =>
  db
    .select({
      bytes: sql<number>`coalesce(sum(${attachments.size}), 0)`.mapWith(Number).as("bytes"),
    })
    .from(attachments)
    .where(and(eq(attachments.uploaderId, uploaderId), isNull(attachments.purgedAt)));

export const usageFor = async (uploaderId: string) => {
  const [row] = await usageOf(uploaderId);
  return row?.bytes ?? 0;
};

// Through each column's encoder, as .values() binds them: a boolean goes in as 0 or 1
const boundValues = (data: Insert) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sql`${sql.param(value, columns[key as keyof Insert])}`.as(key)]),
  ) as Record<keyof Insert, SQL.Aliased>;

/**
 * Undefined when the id is taken, or the file would take its uploader past quotaBytes; the
 * caller reads the id to tell which. One statement, so files added at once can't each see the
 * room the other takes.
 */
export const insertWithinQuota = async (data: Insert, quotaBytes: number) => {
  const usage = usageOf(data.uploaderId).as("usage");
  const [row] = await db
    .insert(attachments)
    .select((qb) =>
      qb
        .select(boundValues(stampsNotAfterNow(data, ["createdAt", "updatedAt"])))
        .from(usage)
        .where(sql`${usage.bytes} + ${data.size} <= ${quotaBytes}`),
    )
    .onConflictDoNothing()
    .returning(sentColumns);
  return row;
};

export const update = async (id: string, fields: Partial<Insert>) => {
  const [row] = await db
    .update(attachments)
    .set(fields)
    .where(and(eq(attachments.id, id), isNull(attachments.purgedAt)))
    .returning(sentColumns);
  return row;
};
