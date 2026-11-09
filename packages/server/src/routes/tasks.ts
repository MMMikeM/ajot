import { z } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { BadRequestError, ForbiddenError, ONLY_CONTACTS } from "../db/errors";
import * as taskRepo from "../db/task.repo";
import * as taskShareRepo from "../db/task-share.repo";
import * as contactRepo from "../db/contact.repo";
import * as categoryRepo from "../db/category.repo";
import { authed, authedRoute } from "../middleware";
import { broadcast, broadcastAll } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import * as notificationQueueRepo from "../db/notification-queue.repo";
import { jsonBody } from "./crud";
import { idBody } from "../db/field-limits";
import * as reachRepo from "../db/reach.repo";
import * as attachmentRepo from "../db/attachment.repo";
import { audienceOf, markTaskEdited, requireTask } from "./task-users";
import { sendReachChanges } from "./reach";
import { inboxOf } from "../widget-inbox";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";
import { MAX_ID, MAX_STATUS_IDS, MAX_USERNAME } from "@newtab-todo/shared/field-limits";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { HTTPException } from "hono/http-exception";
import { taskStatuses } from "../db/schema";
import { limitSharing } from "../rate-limit";

const shareSchema = z.object({
  taskId: z.string().max(MAX_ID),
  username: z.string().min(1, "Choose someone to share with.").max(MAX_USERNAME, ONLY_CONTACTS),
  permission: z.enum(["view", "edit"]).default("edit"),
});

const sendSchema = taskRepo.insertSchema
  .pick({ id: true, title: true, description: true, createdAt: true, updatedAt: true })
  .extend({ recipientId: z.string().max(MAX_ID) });

// A due date is a calendar day, so read in UTC it stays that day wherever the reader is
const dueDateFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const formatDueDate = (dueDate: string) => {
  const day = new Date(`${dueDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? dueDate : dueDateFormat.format(day);
};

const canAssign = async (userId: string, assigneeId: string | null | undefined) =>
  !assigneeId || assigneeId === userId || contactRepo.exists(userId, assigneeId);

const NOT_YOUR_LIST = "That list isn't yours.";
const NOT_A_CONTACT = "You can only assign tasks to your contacts.";
const SUBTASK_GOES_WITH_PARENT = "A subtask goes wherever its parent is.";

const syncReminder = (taskId: string, dueDate: string | null) =>
  dueDate
    ? notificationQueueRepo.scheduleReminder(taskId)
    : notificationQueueRepo.cancelReminder(taskId);

const statusChangeSchema = z.object({
  ids: z
    .array(z.string().max(MAX_ID))
    .min(1)
    .max(MAX_STATUS_IDS, `At most ${MAX_STATUS_IDS} tasks can change at once.`),
  status: z.enum(taskStatuses),
  updatedAt: isoDatetime,
});

const refusalSchema = z.object({ id: z.string(), status: z.number(), error: z.string() });

const shareCategorySchema = z.object({
  taskId: z.string().max(MAX_ID),
  categoryId: z.string().max(MAX_ID).nullable(),
});

export const taskRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(taskRepo.listItemSchema) },
    }),
    async (c) => c.json(await taskRepo.list(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "get",
      path: "/inbox",
      responses: { 200: z.array(taskRepo.listItemSchema) },
    }),
    async (c) => {
      const userId = c.get("userId");
      const [tasks, lists] = await Promise.all([taskRepo.list(userId), categoryRepo.list(userId)]);
      return c.json(inboxOf(tasks, lists, userId), 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(taskRepo.insertSchema),
      responses: { 200: taskRepo.responseSchema, 400: true, 403: true, 404: true, 409: true },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      if (data.parentId && data.categoryId) throw new BadRequestError(SUBTASK_GOES_WITH_PARENT);

      // Sent without a sort key, a task goes where the app puts one it adds
      const [parent, canUseList, mayAssign, sortOrder] = await Promise.all([
        data.parentId ? requireTask(data.parentId, userId, "edit") : null,
        data.categoryId ? categoryRepo.canUse(data.categoryId, userId) : true,
        canAssign(userId, data.assigneeId),
        data.sortOrder === undefined && !data.parentId
          ? taskRepo.nextSortOrder(userId)
          : data.sortOrder,
      ]);
      if (parent?.task.parentId) throw new BadRequestError("Subtasks can't have subtasks.");
      if (!canUseList) throw new ForbiddenError(NOT_YOUR_LIST);
      if (!mayAssign) throw new BadRequestError(NOT_A_CONTACT);

      // An older client doesn't send completedAt
      const result = await taskRepo.insert({
        ...taskChangeStamps({ status: data.status }, data.updatedAt),
        ...data,
        sortOrder,
        userId,
      });
      // A retry of a create that's since been deleted: nothing to announce or remind about
      if (result.deletedAt) return c.json(result, 200);
      if (result.dueDate) await notificationQueueRepo.scheduleFirstReminder(result.id);
      // A retry gets the stored row, which may have been shared or gained subtasks since
      const [added, audience] = await Promise.all([
        taskRepo.findListItem(result.id),
        audienceOf(result.id),
      ]);
      broadcast(c, "tasks", "insert", added, audience);
      if (parent) await markTaskEdited(c, parent.task.id, userId, data.createdAt, parent.access);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/",
      request: jsonBody(taskRepo.updateSchema),
      responses: { 200: taskRepo.responseSchema, 400: true, 403: true, 404: true, 409: true },
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");

      const restoring = fields.deletedAt === null;
      const [{ task, mine, audience }, canUseList, mayAssign] = await Promise.all([
        requireTask(id, userId, restoring ? "manage" : "edit", { deleted: restoring }),
        fields.categoryId ? categoryRepo.canUse(fields.categoryId, userId) : true,
        canAssign(userId, fields.assigneeId),
      ]);
      if (!mayAssign) throw new BadRequestError(NOT_A_CONTACT);
      // Someone it's shared with files their share instead (PUT /share); anyone else moving it
      // could take it away from its owner or its list's people
      if ("categoryId" in fields && !mine.canDelete)
        throw new ForbiddenError("Only its owner can move it to another list.");
      if (fields.categoryId) {
        if (task.parentId) throw new BadRequestError(SUBTASK_GOES_WITH_PARENT);
        if (!canUseList) throw new ForbiddenError(NOT_YOUR_LIST);
      }

      if (restoring) {
        const result = await taskRepo.restore(id, updatedAt);
        // Read again: a task whose list was deleted came back to the Inbox, away from the
        // list's collaborators
        const [row, restoredTo, restoredAttachments] = await Promise.all([
          taskRepo.findListItem(id),
          audienceOf(id),
          attachmentRepo.uploadedOf([id]),
        ]);
        broadcastAll(
          c,
          [
            { model: "tasks", action: "insert", data: row },
            ...restoredAttachments.map((data) => ({
              model: "attachments" as const,
              action: "insert" as const,
              data,
            })),
          ],
          restoredTo,
        );
        return c.json(result, 200);
      }

      // What the client stamped wins; an older one sends neither
      const stamps = taskChangeStamps(fields, updatedAt);
      const notifiableFields = ["title", "description", "status", "dueDate"] as const;
      const changedNotifiable = notifiableFields.filter((f) => f in fields);
      const assigneeChanged = fields.assigneeId && fields.assigneeId !== task.assigneeId;
      const notifies = changedNotifiable.length > 0 || assigneeChanged;
      const actorNameLookup = notifies ? getUserName(userId) : undefined;
      const moving = "categoryId" in fields ? await reachRepo.read({ taskIds: [id] }) : undefined;
      const result = await taskRepo.update(id, updatedAt, { ...stamps, ...fields });
      if (moving) await sendReachChanges(c, moving, [id]);
      else broadcast(c, "tasks", "update", result, audience);
      if (task.parentId && stamps.editedAt)
        await markTaskEdited(c, task.parentId, userId, updatedAt);

      if (actorNameLookup) {
        const actorName = await actorNameLookup;

        const allRecipients = audience.filter((uid) => uid !== userId);

        if (fields.status === "done" && task.status !== "done") {
          for (const recipientId of allRecipients) {
            sendNotification(recipientId, {
              type: "task-completed",
              taskId: id,
              taskTitle: result.title,
              more: 0,
              byUser: actorName,
            });
          }
        } else if (assigneeChanged) {
          sendNotification(fields.assigneeId!, {
            type: "task-assigned",
            taskId: id,
            taskTitle: result.title,
            fromUser: actorName,
          });
        } else if (changedNotifiable.length > 0 && allRecipients.length > 0) {
          const changeDescriptions = changedNotifiable.map((f) => {
            if (f === "title") return "renamed";
            if (f === "description") return "new description";
            if (f === "status") return result.status === "done" ? "marked done" : "reopened";
            return result.dueDate ? `due ${formatDueDate(result.dueDate)}` : "due date removed";
          });
          for (const recipientId of allRecipients) {
            sendNotification(recipientId, {
              type: "task-updated",
              taskId: id,
              taskTitle: result.title,
              more: 0,
              fromUser: actorName,
              changes: changeDescriptions.join(", "),
            });
          }
        }
      }

      // Re-picking the date a reminder already went out for would send it again
      if (result.dueDate !== task.dueDate) await syncReminder(id, result.dueDate);

      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/status",
      request: jsonBody(statusChangeSchema),
      responses: {
        200: z.object({
          updated: z.array(taskRepo.responseSchema),
          refused: z.array(refusalSchema),
        }),
      },
    }),
    // Each task as PUT / would change it, with one notification per person for the lot, where
    // PUT / sends one for each task
    async (c) => {
      const { ids, status, updatedAt } = c.req.valid("json");
      const userId = c.get("userId");
      const actorNameLookup = getUserName(userId);
      const stamps = taskChangeStamps({ status }, updatedAt);
      const unique = [...new Set(ids)];
      const outcomes = await Promise.allSettled(
        unique.map(async (id) => {
          const { task, audience } = await requireTask(id, userId, "edit");
          const result = await taskRepo.update(id, updatedAt, { ...stamps, status });
          broadcast(c, "tasks", "update", result, audience);
          return { before: task, result, audience };
        }),
      );

      const updated = outcomes.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []));
      const refused = outcomes.flatMap((o, i) => {
        if (o.status === "fulfilled") return [];
        const id = unique[i]!;
        if (o.reason instanceof HTTPException)
          return [{ id, status: o.reason.status, error: o.reason.message }];
        console.error(`[tasks] couldn't change ${id}'s status:`, o.reason);
        return [{ id, status: 500, error: "Couldn't change it. Try again." }];
      });

      const changedFor = new Map<string, { id: string; title: string }[]>();
      for (const { before, result, audience } of updated) {
        if (before.status === result.status) continue;
        for (const recipientId of audience)
          if (recipientId !== userId)
            changedFor.set(recipientId, [...(changedFor.get(recipientId) ?? []), result]);
      }
      if (changedFor.size > 0) {
        const actorName = await actorNameLookup;
        for (const [recipientId, [first, ...others]] of changedFor) {
          const about = { taskId: first!.id, taskTitle: first!.title, more: others.length };
          sendNotification(
            recipientId,
            status === "done"
              ? { type: "task-completed", ...about, byUser: actorName }
              : { type: "task-updated", ...about, fromUser: actorName, changes: "reopened" },
          );
        }
      }

      return c.json({ updated: updated.map((u) => u.result), refused }, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/",
      request: jsonBody(idBody),
      responses: { 200: taskRepo.responseSchema, 403: true, 404: true },
    }),
    async (c) => {
      const { id } = c.req.valid("json");
      const userId = c.get("userId");

      const { audience } = await requireTask(id, userId, "manage");

      const { task: removed, subtaskIds } = await taskRepo.remove(id);
      broadcastAll(
        c,
        [removed.id, ...subtaskIds].map((removedId) => ({
          model: "tasks" as const,
          action: "delete" as const,
          data: { id: removedId },
        })),
        audience,
      );
      return c.json(removed, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/send",
      request: jsonBody(sendSchema),
      responses: {
        200: taskRepo.responseSchema,
        400: true,
        404: true,
        409: true,
        429: true,
      },
    }),
    async (c) => {
      const { recipientId, ...data } = c.req.valid("json");
      const userId = c.get("userId");
      limitSharing(userId);
      const [isContact, sortOrder, actorName] = await Promise.all([
        contactRepo.exists(userId, recipientId),
        taskRepo.nextSortOrder(recipientId),
        getUserName(userId),
      ]);
      if (!isContact) throw new BadRequestError("You can only send tasks to your contacts.");

      // The recipient owns it, as if they'd added it, so it lands in their Inbox and not the sender's
      const result = await taskRepo.insertSent({
        ...data,
        userId: recipientId,
        sentById: userId,
        sortOrder,
      });
      // As the list sends it, so the recipient's devices can say who sent it, offline too
      broadcast(c, "tasks", "insert", await taskRepo.findListItem(result.id), [recipientId]);

      sendNotification(recipientId, {
        type: "task-sent",
        taskId: result.id,
        taskTitle: result.title,
        fromUser: actorName,
      });

      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/share",
      request: jsonBody(shareSchema),
      responses: { 200: taskShareRepo.responseSchema, 400: true, 403: true, 404: true, 429: true },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      limitSharing(userId);
      const [{ task }, targetUser, actorName] = await Promise.all([
        requireTask(data.taskId, userId, "manage"),
        contactRepo.findContactUser(userId, data.username.toLowerCase()),
        getUserName(userId),
      ]);
      if (task.parentId) throw new BadRequestError(SUBTASK_GOES_WITH_PARENT);
      if (!targetUser) throw new BadRequestError(ONLY_CONTACTS);

      const before = await reachRepo.read({ taskIds: [task.id] });
      const {
        share: result,
        added,
        changed,
      } = await taskShareRepo.insert({
        id: createId(),
        taskId: task.id,
        sharedWithUserId: targetUser.id,
        permission: data.permission,
      });
      if (!changed) return c.json(result, 200);
      await sendReachChanges(c, before, [task.id]);
      // A new permission on a share they already had isn't news to them
      if (!added) return c.json(result, 200);

      sendNotification(targetUser.id, {
        type: "task-shared",
        taskId: data.taskId,
        taskTitle: task.title,
        fromUser: actorName,
      });

      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/share",
      request: jsonBody(idBody),
      responses: { 200: taskShareRepo.responseSchema, 403: true, 404: true },
    }),
    async (c) => {
      const share = await taskShareRepo.find(c.req.valid("json").id);
      // Someone who can't see the task gets the same 404 as for a share that doesn't exist
      await requireTask(share.taskId, c.get("userId"), "manage");
      const before = await reachRepo.read({ taskIds: [share.taskId] });
      const result = await taskShareRepo.remove(share.id);
      await sendReachChanges(c, before, [share.taskId]);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/share",
      request: jsonBody(shareCategorySchema),
      responses: { 200: taskShareRepo.responseSchema, 403: true, 404: true },
    }),
    async (c) => {
      const { taskId, categoryId } = c.req.valid("json");
      const userId = c.get("userId");
      if (categoryId && !(await categoryRepo.canUse(categoryId, userId)))
        throw new ForbiddenError(NOT_YOUR_LIST);
      const result = await taskShareRepo.updateCategory(taskId, userId, categoryId);
      // The user's other devices file it too
      const [{ shares } = { shares: [] }] = await taskShareRepo.listForTasks([taskId]);
      broadcast(c, "tasks", "update", { id: taskId, shares }, [userId]);
      return c.json(result, 200);
    },
  );
