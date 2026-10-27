import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createId } from "@paralleldrive/cuid2";
import { BadRequestError, ForbiddenError } from "../db/errors";
import taskRepo, {
  taskInsertSchema,
  taskUpdateSchema,
  taskSelectSchema,
  taskShareSelectSchema,
  taskResponseSchema,
  taskShareResponseSchema,
  taskListItemSchema,
} from "../db/task.repo";
import userRepo from "../db/user.repo";
import contactRepo from "../db/contact.repo";
import categoryRepo from "../db/category.repo";
import { authed } from "../middleware";
import { broadcast, broadcastAll, type TaskEvent } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import notificationQueueRepo from "../db/notification-queue.repo";
import { errorSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";
import { audienceOf, markTaskEdited, requireTask } from "./task-users";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";

const shareSchema = z.object({
  taskId: z.string(),
  username: z.string().min(1),
  permission: z.enum(["view", "edit"]).default("edit"),
});

const sendSchema = taskInsertSchema
  .pick({ id: true, title: true, description: true, createdAt: true, updatedAt: true })
  .extend({ recipientId: z.string() });

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

const notYourList = () => new ForbiddenError("That list isn't yours.");
const notAContact = () => new BadRequestError("You can only assign tasks to your contacts.");
const subtaskGoesWithParent = () => new BadRequestError("A subtask goes wherever its parent is.");

/**
 * A move to another list changes who reaches the task and its subtasks: whoever gains it gets
 * them, whoever loses it has them taken off, and the rest get the change.
 */
const broadcastMove = async (
  c: Context,
  id: string,
  result: Parameters<typeof broadcast>[3],
  before: string[],
) => {
  const after = await audienceOf(id);
  const gained = after.filter((u) => !before.includes(u));
  const lost = before.filter((u) => !after.includes(u));
  const kept = before.filter((u) => after.includes(u));
  broadcast(c, "tasks", "update", result, kept);
  if (gained.length === 0 && lost.length === 0) return;
  const rows = await taskRepo.findListItemWithSubtasks(id);
  const inserts = rows.map((data): TaskEvent => ({ model: "tasks", action: "insert", data }));
  const deletes = rows.map(({ id }): TaskEvent => ({
    model: "tasks",
    action: "delete",
    data: { id },
  }));
  broadcastAll(c, inserts, gained);
  broadcastAll(c, deletes, lost);
};

const shareCategorySchema = z.object({
  taskId: z.string(),
  categoryId: z.string().nullable(),
});

export const taskRoutes = authed()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: withAuth({ 200: jsonContent(z.array(taskListItemSchema)) }),
    }),
    async (c) => c.json(await taskRepo.list(c.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/",
      request: jsonBody(taskInsertSchema),
      responses: withAuth({
        200: jsonContent(taskResponseSchema),
        400: jsonContent(errorSchema, "Bad request"),
      }),
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      if (data.parentId && data.categoryId) throw subtaskGoesWithParent();

      const [parent, canUseList, mayAssign] = await Promise.all([
        data.parentId ? requireTask(data.parentId, userId, "edit") : null,
        data.categoryId ? categoryRepo.canUse(data.categoryId, userId) : true,
        canAssign(userId, data.assigneeId),
      ]);
      if (parent?.task.parentId)
        throw new HTTPException(400, { message: "Subtasks can't have subtasks." });
      if (!canUseList) throw notYourList();
      if (!mayAssign) throw notAContact();

      // A client from before completedAt existed doesn't send it
      const result = await taskRepo.insert({
        ...taskChangeStamps({ status: data.status }, data.updatedAt),
        ...data,
        userId,
      });
      const added = { ...result, subtasks: [], shares: [] };
      broadcast(c, "tasks", "insert", added, await audienceOf(result.id));
      if (parent) await markTaskEdited(c, parent.task.id, userId, data.createdAt, parent.access);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/",
      request: jsonBody(taskUpdateSchema),
      responses: withAuth({ 200: jsonContent(taskResponseSchema) }),
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");

      const restoring = fields.deletedAt === null;
      const [{ task, mine, audience }, canUseList, mayAssign] = await Promise.all([
        // As with deleting, only the owner can bring a task back
        requireTask(id, userId, restoring ? "delete" : "edit", { deleted: restoring }),
        fields.categoryId ? categoryRepo.canUse(fields.categoryId, userId) : true,
        canAssign(userId, fields.assigneeId),
      ]);
      if (!mayAssign) throw notAContact();
      // Someone it's shared with files their share instead (PUT /share); anyone else moving it
      // could take it away from its owner or its list's people
      if ("categoryId" in fields && !mine.canDelete)
        throw new ForbiddenError("Only its owner can move it to another list.");
      if (fields.categoryId) {
        if (task.parentId) throw subtaskGoesWithParent();
        if (!canUseList) throw notYourList();
      }

      if (restoring) {
        const result = await taskRepo.restore(id, updatedAt);
        // Read again: a task whose list was deleted came back to the Inbox, away from the
        // list's collaborators
        broadcast(c, "tasks", "insert", await taskRepo.findListItem(id), await audienceOf(id));
        return c.json(result, 200);
      }

      // What the client stamped wins; one from before these columns existed sends neither
      const stamps = taskChangeStamps(fields, updatedAt);
      const result = await taskRepo.update(id, updatedAt, { ...stamps, ...fields });
      if ("categoryId" in fields) await broadcastMove(c, id, result, audience);
      else broadcast(c, "tasks", "update", result, audience);
      if (task.parentId && stamps.editedAt)
        await markTaskEdited(c, task.parentId, userId, updatedAt);

      const notifiableFields = ["title", "description", "status", "dueDate"] as const;
      const changedNotifiable = notifiableFields.filter((f) => f in fields);
      const assigneeChanged = fields.assigneeId && fields.assigneeId !== task.assigneeId;

      if (changedNotifiable.length > 0 || assigneeChanged) {
        const actorName = await getUserName(userId);

        const allRecipients = audience.filter((uid) => uid !== userId);

        if (fields.status === "done" && task.status !== "done") {
          for (const recipientId of allRecipients) {
            sendNotification(recipientId, {
              type: "task-completed",
              taskId: id,
              taskTitle: result.title,
              byUser: actorName,
            }).catch(() => {});
          }
        } else if (assigneeChanged) {
          sendNotification(fields.assigneeId!, {
            type: "task-assigned",
            taskId: id,
            taskTitle: result.title,
            fromUser: actorName,
          }).catch(() => {});
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
              fromUser: actorName,
              changes: changeDescriptions.join(", "),
            }).catch(() => {});
          }
        }
      }

      if ("dueDate" in fields) {
        await notificationQueueRepo.deleteByTask(id);
        if (fields.dueDate) {
          await notificationQueueRepo.insert({
            userId: task.userId,
            type: "reminder-due",
            taskId: id,
            scheduledFor: fields.dueDate,
          });
        }
      }

      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/",
      request: jsonBody(taskSelectSchema),
      responses: withAuth({ 200: jsonContent(taskResponseSchema) }),
    }),
    async (c) => {
      const { id } = c.req.valid("json");
      const userId = c.get("userId");

      const { audience } = await requireTask(id, userId, "delete");

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
    createRoute({
      method: "post",
      path: "/send",
      request: jsonBody(sendSchema),
      responses: withAuth({
        200: jsonContent(taskResponseSchema),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { recipientId, ...data } = c.req.valid("json");
      const userId = c.get("userId");
      if (!(await contactRepo.exists(userId, recipientId)))
        throw new HTTPException(403, { message: "You can only send tasks to your contacts." });

      // The recipient owns it, as if they'd added it, so it lands in their Inbox and not the sender's
      const result = await taskRepo.insertSent({
        ...data,
        userId: recipientId,
        sortOrder: await taskRepo.nextSortOrder(recipientId),
      });
      broadcast(c, "tasks", "insert", { ...result, subtasks: [], shares: [] }, [recipientId]);

      const actorName = await getUserName(userId);
      sendNotification(recipientId, {
        type: "task-sent",
        taskId: result.id,
        taskTitle: result.title,
        fromUser: actorName,
      }).catch(() => {});

      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/share",
      request: jsonBody(shareSchema),
      responses: withAuth({
        200: jsonContent(taskShareResponseSchema),
        400: jsonContent(errorSchema, "Bad request"),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      const [task, targetUser] = await Promise.all([
        taskRepo.findById(data.taskId),
        userRepo.findByUsername(data.username.toLowerCase()),
      ]);
      if (task.userId !== userId)
        throw new HTTPException(403, { message: "Only the task's owner can share it." });
      if (task.parentId) throw subtaskGoesWithParent();
      if (targetUser.id === userId)
        throw new HTTPException(400, { message: "That's you. Choose someone else." });

      const result = await taskRepo.insertShare({
        id: createId(),
        taskId: data.taskId,
        sharedWithUserId: targetUser.id,
        permission: data.permission,
      });
      broadcast(c, "tasks", "update", { id: data.taskId }, [task.userId, targetUser.id]);

      const actorName = await getUserName(userId);
      sendNotification(targetUser.id, {
        type: "task-shared",
        taskId: data.taskId,
        taskTitle: task.title,
        fromUser: actorName,
      }).catch(() => {});

      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/share",
      request: jsonBody(taskShareSelectSchema),
      responses: withAuth({ 200: jsonContent(taskShareResponseSchema) }),
    }),
    async (c) => {
      const result = await taskRepo.removeShare(c.req.valid("json").id, c.get("userId"));
      const task = await taskRepo.findById(result.taskId);
      broadcast(c, "tasks", "update", { id: result.taskId }, [
        task.userId,
        result.sharedWithUserId,
      ]);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/share",
      request: jsonBody(shareCategorySchema),
      responses: withAuth({ 200: jsonContent(taskShareResponseSchema) }),
    }),
    async (c) => {
      const { taskId, categoryId } = c.req.valid("json");
      const userId = c.get("userId");
      if (categoryId && !(await categoryRepo.canUse(categoryId, userId))) throw notYourList();
      const result = await taskRepo.updateShareCategory(taskId, userId, categoryId);
      // The user's other devices file it too
      const [{ shares } = { shares: [] }] = await taskRepo.listSharesForTasks([taskId]);
      broadcast(c, "tasks", "update", { id: taskId, shares }, [userId]);
      return c.json(result, 200);
    },
  );
