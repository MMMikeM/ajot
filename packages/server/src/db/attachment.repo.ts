import { and, eq, getColumns, inArray, isNull, sum } from "drizzle-orm";
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

const { purgedAt: _purgedAt, ...sentColumns } = getColumns(attachments);

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

/** Undefined when the id is taken: the caller reads it to tell a retry from a clash. */
export const insert = async (data: Insert) => {
  const [row] = await db
    .insert(attachments)
    .values(stampsNotAfterNow(data, ["createdAt", "updatedAt"]))
    .onConflictDoNothing()
    .returning(sentColumns);
  return row;
};

/** Every byte that may still be stored, which only the purge frees. */
export const usageFor = async (uploaderId: string) => {
  const [row] = await db
    .select({ bytes: sum(attachments.size).mapWith(Number) })
    .from(attachments)
    .where(and(eq(attachments.uploaderId, uploaderId), isNull(attachments.purgedAt)));
  return row?.bytes ?? 0;
};

export const update = async (id: string, fields: Partial<Insert>) => {
  const [row] = await db
    .update(attachments)
    .set(fields)
    .where(and(eq(attachments.id, id), isNull(attachments.purgedAt)))
    .returning(sentColumns);
  return row;
};
