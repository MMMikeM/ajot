import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { canDeleteAttachment } from "@newtab-todo/shared/task-access";
import { opensInTab, servedType } from "@newtab-todo/shared/attachments";
import { MAX_ID } from "@newtab-todo/shared/field-limits";
import { now } from "@newtab-todo/shared/iso";
import attachmentRepo, {
  attachmentIdSchema,
  attachmentInsertSchema,
  attachmentResponseSchema,
  type Attachment,
} from "../db/attachment.repo";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  GoneError,
  IdTakenError,
  NotFoundError,
  TooLargeError,
} from "../db/errors";
import { authed, authedRoute } from "../middleware";
import { broadcast } from "../broadcast";
import { limitAttaching } from "../rate-limit";
import { encodeRfc3986, fileKey, stagedKey, storage, thumbKey } from "../storage";
import {
  ATTACHMENT_QUOTA_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_THUMB_BYTES,
  MB,
} from "../attachment-limits";
import { jsonBody } from "./crud";
import { requireTask } from "./task-users";

const ATTACHMENTS_OFF = "This server doesn't take attachments.";
const ATTACHMENT_DELETED = "That file was deleted.";
const TASK_DELETED = "That task was deleted.";
const NOT_UPLOADED = "The file didn't finish uploading. Try again.";

const uploadUrlRequestSchema = attachmentIdSchema
  .extend({ thumbSize: z.number().int().positive().max(MAX_THUMB_BYTES).optional() })
  .strict();
const uploadUrlsSchema = z.object({ file: z.string(), thumb: z.string().optional() });
const urlsRequestSchema = z
  .object({ ids: z.array(z.string().max(MAX_ID)).max(100), variant: z.enum(["file", "thumb"]) })
  .strict();
const urlsSchema = z.array(z.object({ id: z.string(), url: z.string() }));

const audienceFor = (row: Attachment, audience: string[]) =>
  row.uploadedAt ? audience : [row.uploaderId];

const disposition = (row: Attachment) =>
  `${opensInTab(row.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeRfc3986(row.name)}`;

const sent = ({ purgedAt: _purgedAt, ...row }: Attachment & { purgedAt: string | null }) => row;

const findOwnUnfinished = async (id: string, userId: string) => {
  const row = await attachmentRepo.find(id);
  if (!row || row.uploaderId !== userId) throw new NotFoundError("attachment", id);
  if (row.deletedAt) throw new GoneError(ATTACHMENT_DELETED);
  return row;
};

const requireLiveTask = async (taskId: string, userId: string) => {
  const found = await requireTask(taskId, userId, "edit", { deleted: true });
  if (found.task.deletedAt) throw new GoneError(TASK_DELETED);
  return found;
};

const deleteOrRestore = async (c: Context, id: string, deletedAt: string | null) => {
  const userId = c.get("userId");
  const row = await attachmentRepo.find(id);
  if (!row) throw new NotFoundError("attachment", id);
  if (row.purgedAt) throw new GoneError(ATTACHMENT_DELETED);
  const { task, mine, audience } = await requireTask(row.taskId, userId, "see", { deleted: true });
  if (!canDeleteAttachment(row, mine))
    throw new ForbiddenError("Only whoever added it or the task's owner can do that.");
  if (!row.deletedAt === !deletedAt) return sent(row);
  const result = await attachmentRepo.update(id, { deletedAt, updatedAt: now() });
  if (!result) throw new GoneError(ATTACHMENT_DELETED);
  if (!task.deletedAt)
    broadcast(
      c,
      "attachments",
      deletedAt ? "delete" : "insert",
      deletedAt ? { id } : result,
      audienceFor(result, audience),
    );
  return result;
};

export const attachmentRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(attachmentResponseSchema) },
    }),
    async (c) => c.json(await attachmentRepo.list(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(attachmentInsertSchema),
      responses: {
        200: attachmentResponseSchema,
        403: true,
        404: true,
        409: true,
        410: true,
        413: true,
        429: true,
      },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      if (!storage) throw new ForbiddenError(ATTACHMENTS_OFF);
      const taken = await attachmentRepo.find(data.id);
      // A retry after a lost response gets its row back, unless it was deleted meanwhile
      if (taken?.uploaderId === userId) {
        if (taken.deletedAt) throw new GoneError(ATTACHMENT_DELETED);
        return c.json(sent(taken), 200);
      }
      if (taken) throw new IdTakenError("attachment", data.id);
      if (data.size > MAX_ATTACHMENT_BYTES)
        throw new TooLargeError(`A file can be at most ${MAX_ATTACHMENT_BYTES / MB} MB.`);
      await requireLiveTask(data.taskId, userId);
      if ((await attachmentRepo.usageFor(userId)) + data.size > ATTACHMENT_QUOTA_BYTES)
        throw new TooLargeError(`That's over your ${ATTACHMENT_QUOTA_BYTES / MB} MB of files.`);
      limitAttaching(userId);
      const result = await attachmentRepo.insert({ ...data, uploaderId: userId });
      if (!result) throw new IdTakenError("attachment", data.id);
      broadcast(c, "attachments", "insert", result, [userId]);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/",
      request: jsonBody(attachmentIdSchema.strict()),
      responses: { 200: attachmentResponseSchema, 403: true, 404: true, 410: true },
    }),
    async (c) => c.json(await deleteOrRestore(c, c.req.valid("json").id, null), 200),
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/",
      request: jsonBody(attachmentIdSchema.strict()),
      responses: { 200: attachmentResponseSchema, 403: true, 404: true, 410: true },
    }),
    async (c) => c.json(await deleteOrRestore(c, c.req.valid("json").id, now()), 200),
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/upload-url",
      request: jsonBody(uploadUrlRequestSchema),
      responses: { 200: uploadUrlsSchema, 400: true, 403: true, 404: true, 409: true, 410: true },
    }),
    async (c) => {
      const { id, thumbSize } = c.req.valid("json");
      const userId = c.get("userId");
      if (!storage) throw new ForbiddenError(ATTACHMENTS_OFF);
      const row = await findOwnUnfinished(id, userId);
      // /complete answers again for one already uploaded
      if (row.uploadedAt) throw new ConflictError("That file is already uploaded.");
      if (row.hasThumb && !thumbSize) throw new BadRequestError(NOT_UPLOADED);
      await requireLiveTask(row.taskId, userId);
      const [file, thumb] = await Promise.all([
        storage.presignPut(stagedKey(fileKey(id)), row.size, servedType(row.mimeType)),
        row.hasThumb && thumbSize
          ? storage.presignPut(stagedKey(thumbKey(id)), thumbSize, "image/jpeg")
          : undefined,
      ]);
      return c.json({ file, thumb }, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/complete",
      request: jsonBody(attachmentIdSchema.strict()),
      responses: { 200: attachmentResponseSchema, 400: true, 403: true, 404: true, 410: true },
    }),
    async (c) => {
      const { id } = c.req.valid("json");
      const userId = c.get("userId");
      if (!storage) throw new ForbiddenError(ATTACHMENTS_OFF);
      const row = await findOwnUnfinished(id, userId);
      if (row.uploadedAt) return c.json(sent(row), 200);
      const { audience } = await requireLiveTask(row.taskId, userId);
      const file = fileKey(id);
      const thumb = thumbKey(id);
      const [fileSize, thumbSize] = await Promise.all([
        storage.sizeOf(stagedKey(file)),
        row.hasThumb ? storage.sizeOf(stagedKey(thumb)) : 0,
      ]);
      // The signed length should make a mismatch impossible; one that gets through is deleted
      // rather than counted at the size it claimed
      if (fileSize !== row.size) {
        if (fileSize !== undefined) await storage.remove(stagedKey(file));
        throw new BadRequestError(NOT_UPLOADED);
      }
      if (thumbSize === undefined || thumbSize > MAX_THUMB_BYTES) {
        if (thumbSize !== undefined) await storage.remove(stagedKey(thumb));
        throw new BadRequestError(NOT_UPLOADED);
      }
      const keys = row.hasThumb ? [file, thumb] : [file];
      const { copy, remove } = storage;
      await Promise.all(keys.map((key) => copy(stagedKey(key), key)));
      const result = await attachmentRepo.update(id, { uploadedAt: now(), updatedAt: now() });
      if (!result) throw new GoneError(ATTACHMENT_DELETED);
      broadcast(c, "attachments", "insert", result, audience);
      await Promise.all(keys.map((key) => remove(stagedKey(key))));
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/urls",
      request: jsonBody(urlsRequestSchema),
      responses: { 200: urlsSchema, 403: true },
    }),
    async (c) => {
      const { ids, variant } = c.req.valid("json");
      if (!storage) throw new ForbiddenError(ATTACHMENTS_OFF);
      const { presignGet } = storage;
      const rows = await attachmentRepo.listByIds(ids, c.get("userId"));
      const urls = await Promise.all(
        rows
          .filter((row) => variant === "file" || row.hasThumb)
          .map(async (row) => ({
            id: row.id,
            url:
              variant === "file"
                ? await presignGet(fileKey(row.id), disposition(row))
                : await presignGet(thumbKey(row.id), "inline"),
          })),
      );
      return c.json(urls, 200);
    },
  );
