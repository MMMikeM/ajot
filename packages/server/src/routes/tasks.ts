import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { createId } from "@paralleldrive/cuid2";
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
import categoryCollaboratorRepo from "../db/category-collaborator.repo";
import { authed } from "../middleware";
import { broadcast, broadcastAll } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import notificationQueueRepo from "../db/notification-queue.repo";
import { errorSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";
import { markTaskEdited, taskUserIds } from "./task-users";
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

      // Subtasks carry no categoryId; their collaborators come from the parent's category
      let effectiveCategoryId = data.categoryId;
      if (data.parentId) {
        const parent = await taskRepo.findByIdWithAccess(data.parentId, userId);
        if (parent.parentId)
          throw new HTTPException(400, { message: "Subtasks can't have subtasks." });
        const canAddTo =
          parent.userId === userId ||
          parent.shares.some((s) => s.sharedWithUserId === userId) ||
          !!parent.category?.collaborators.some((c) => c.userId === userId);
        if (!canAddTo) throw new HTTPException(403, { message: "Not authorized" });
        effectiveCategoryId = parent.categoryId;
      } else if (data.categoryId && !(await categoryRepo.canUse(data.categoryId, userId))) {
        throw new HTTPException(403, { message: "That list isn't yours." });
      }

      // A client from before completedAt existed doesn't send it
      const result = await taskRepo.insert({
        ...taskChangeStamps({ status: data.status }, data.updatedAt),
        ...data,
        userId,
      });
      // A retry gets its own row back; an id someone else's task already has must not
      if (result.userId !== userId) throw new HTTPException(409, { message: "Task id taken" });
      const taskWithRelations = { ...result, subtasks: [], shares: [] };

      const collabIds = effectiveCategoryId
        ? await categoryCollaboratorRepo.listUserIds(effectiveCategoryId)
        : [];
      broadcast(c, "tasks", "insert", taskWithRelations, [...new Set([userId, ...collabIds])]);
      if (data.parentId) await markTaskEdited(c, data.parentId, userId, data.createdAt);
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
      const [task, isContact, canUseList] = await Promise.all([
        taskRepo.findByIdWithAccess(id, userId, { deleted: restoring }),
        fields.assigneeId ? contactRepo.exists(userId, fields.assigneeId) : Promise.resolve(true),
        fields.categoryId ? categoryRepo.canUse(fields.categoryId, userId) : Promise.resolve(true),
      ]);

      const collabUserIds = [
        ...(task.category?.collaborators.map((c) => c.userId) ?? []),
        ...(task.parent?.category?.collaborators.map((c) => c.userId) ?? []),
      ];
      const shareUserIds = [
        ...task.shares.map((s) => s.sharedWithUserId),
        ...(task.parent?.shares?.map((s) => s.sharedWithUserId) ?? []),
      ];
      const isOwner = task.userId === userId || task.parent?.userId === userId;
      const isCollab = collabUserIds.includes(userId);
      const isShareRecipient = shareUserIds.includes(userId);
      if (!isOwner && !isCollab && !isShareRecipient)
        throw new HTTPException(403, { message: "Not authorized" });
      if (!isContact)
        throw new HTTPException(400, { message: "You can only assign tasks to your contacts." });
      if (!canUseList) throw new HTTPException(403, { message: "That list isn't yours." });
      // As with deleting, only the owner can bring a task back
      if (restoring && !isOwner) throw new HTTPException(403, { message: "Not authorized" });

      if (restoring) {
        const result = await taskRepo.restore(id, updatedAt);
        // Read again: a task whose list was deleted came back to the Inbox, away from the
        // list's collaborators
        const restored = await taskRepo.findByIdWithAccess(id, userId);
        broadcast(c, "tasks", "insert", await taskRepo.findListItem(id), taskUserIds(restored));
        return c.json(result, 200);
      }

      // What the client stamped wins; one from before these columns existed sends neither
      const stamps = taskChangeStamps(fields, updatedAt);
      const result = await taskRepo.update(id, updatedAt, { ...stamps, ...fields });
      broadcast(c, "tasks", "update", result, taskUserIds(task));
      if (result.parentId && stamps.editedAt)
        await markTaskEdited(c, result.parentId, userId, updatedAt);

      const notifiableFields = ["title", "description", "status", "dueDate"] as const;
      const changedNotifiable = notifiableFields.filter((f) => f in fields);
      const assigneeChanged = fields.assigneeId && fields.assigneeId !== task.assigneeId;

      if (changedNotifiable.length > 0 || assigneeChanged) {
        const actorName = await getUserName(userId);

        const shareUserIds = await taskRepo.listShareUserIds(id).catch(() => []);
        const allRecipients = [...new Set([...taskUserIds(task), ...shareUserIds])].filter(
          (uid) => uid !== userId,
        );

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

      const task = await taskRepo.findByIdWithAccess(id, userId);
      const isOwner = task.userId === userId || task.parent?.userId === userId;
      if (!isOwner) throw new HTTPException(403, { message: "Not authorized" });

      const { task: removed, subtaskIds } = await taskRepo.remove(id);
      broadcastAll(
        c,
        [removed.id, ...subtaskIds].map((removedId) => ({
          model: "tasks" as const,
          action: "delete" as const,
          data: { id: removedId },
        })),
        taskUserIds(task),
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
      const result = await taskRepo.insert({
        ...data,
        userId: recipientId,
        sortOrder: await taskRepo.nextSortOrder(recipientId),
      });
      if (result.userId !== recipientId) throw new HTTPException(409, { message: "Task id taken" });
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
      const result = await taskRepo.updateShareCategory(taskId, userId, categoryId);
      broadcast(c, "tasks", "update", { id: taskId }, [userId]);
      return c.json(result, 200);
    },
  );
