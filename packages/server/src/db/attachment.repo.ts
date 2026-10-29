import { and, eq, getColumns, inArray, isNotNull, isNull, or, sum } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-orm/zod";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { MAX_FILE_NAME, MAX_SHORT } from "@newtab-todo/shared/field-limits";
import { db } from "./client";
import { attachments, taskAccess, tasks } from "./schema";
import { limited, limitedId } from "./field-limits";
import { stampsNotAfterNow } from "./stamps";

export type AttachmentInsert = typeof attachments.$inferInsert;
export type Attachment = Omit<typeof attachments.$inferSelect, "purgedAt">;

const { purgedAt: _purgedAt, ...sentColumns } = getColumns(attachments);

export const attachmentResponseSchema = createSelectSchema(attachments).omit({ purgedAt: true });
export const attachmentInsertSchema = createInsertSchema(attachments, {
  id: limitedId,
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
export const attachmentIdSchema = createSelectSchema(attachments, { id: limitedId }).pick({
  id: true,
});

const shownTo = (userId: string) =>
  and(
    eq(taskAccess.userId, userId),
    isNull(tasks.deletedAt),
    isNull(attachments.deletedAt),
    or(isNotNull(attachments.uploadedAt), eq(attachments.uploaderId, userId)),
  );

/** Everyone sees one once it's uploaded; until then, only its uploader. */
const list = async (userId: string) =>
  db
    .select(sentColumns)
    .from(attachments)
    .innerJoin(taskAccess, eq(taskAccess.taskId, attachments.taskId))
    .innerJoin(tasks, eq(tasks.id, attachments.taskId))
    .where(shownTo(userId));

const listByIds = async (ids: string[], userId: string) =>
  ids.length === 0
    ? []
    : db
        .select(sentColumns)
        .from(attachments)
        .innerJoin(taskAccess, eq(taskAccess.taskId, attachments.taskId))
        .innerJoin(tasks, eq(tasks.id, attachments.taskId))
        .where(and(inArray(attachments.id, ids), shownTo(userId)));

const find = async (id: string) => db.query.attachments.findFirst({ where: { id } });

const uploadedOf = async (taskIds: string[]) =>
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
const insert = async (data: AttachmentInsert) => {
  const [row] = await db
    .insert(attachments)
    .values(stampsNotAfterNow(data, ["createdAt", "updatedAt"]))
    .onConflictDoNothing()
    .returning(sentColumns);
  return row;
};

/** Every byte that may still be stored, which only the purge frees. */
const usageFor = async (uploaderId: string) => {
  const [row] = await db
    .select({ bytes: sum(attachments.size).mapWith(Number) })
    .from(attachments)
    .where(and(eq(attachments.uploaderId, uploaderId), isNull(attachments.purgedAt)));
  return row?.bytes ?? 0;
};

const update = async (id: string, fields: Partial<AttachmentInsert>) => {
  const [row] = await db
    .update(attachments)
    .set(fields)
    .where(and(eq(attachments.id, id), isNull(attachments.purgedAt)))
    .returning(sentColumns);
  return row;
};

export default { list, listByIds, find, uploadedOf, insert, usageFor, update };
