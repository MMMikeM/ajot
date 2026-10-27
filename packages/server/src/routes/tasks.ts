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
import categoryRepo, { isMember } from "../db/category.repo";
import { authed } from "../middleware";
import { broadcast, broadcastAll } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import notificationQueueRepo from "../db/notification-queue.repo";
import { errorSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";
import { markTaskEdited, requireTask } from "./task-users";
import { audience, canDeleteTask } from "@newtab-todo/shared/task-access";
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

// Yourself, or a contact
const canAssign = async (userId: string, assigneeId: string | null | undefined) =>
  !assigneeId || assigneeId === userId || contactRepo.exists(userId, assigneeId);

const notYourList = () => new HTTPException(403, { message: "That list isn't yours." });
const notAContact = () =>
  new HTTPException(400, { message: "You can only assign tasks to your contacts." });
// A subtask goes wherever its parent is; a list of its own would add that list's people to it
const subtaskList = () =>
  new HTTPException(400, { message: "A subtask goes wherever its parent is." });

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
      if (data.parentId && data.categoryId) throw subtaskList();

      const [parent, list, mayAssign] = await Promise.all([
        data.parentId ? requireTask(data.parentId, userId, "edit") : null,
        data.categoryId ? categoryRepo.findMembers(data.categoryId) : undefined,
        canAssign(userId, data.assigneeId),
      ]);
      if (parent?.parentId)
        throw new HTTPException(400, { message: "Subtasks can't have subtasks." });
      if (data.categoryId && !isMember(list, userId)) throw notYourList();
      if (!mayAssign) throw notAContact();

      // A client from before completedAt existed doesn't send it
      const result = await taskRepo.insert({
        ...taskChangeStamps({ status: data.status }, data.updatedAt),
        ...data,
        userId,
      });
      const reach = parent ?? { userId, category: list };
      broadcast(c, "tasks", "insert", { ...result, subtasks: [], shares: [] }, audience(reach));
      if (parent) await markTaskEdited(c, parent, userId, data.createdAt);
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
      const [task, list, mayAssign] = await Promise.all([
        // As with deleting, only the owner can bring a task back
        requireTask(id, userId, restoring ? "delete" : "edit", { deleted: restoring }),
        fields.categoryId ? categoryRepo.findMembers(fields.categoryId) : undefined,
        canAssign(userId, fields.assigneeId),
      ]);
      if (!mayAssign) throw notAContact();
      // Someone it's shared with files their share instead (PUT /share); anyone else moving it
      // could take it away from its owner or its list's people
      if ("categoryId" in fields && !canDeleteTask(task, userId))
        throw new HTTPException(403, { message: "Only its owner can move it to another list." });
      if (fields.categoryId) {
        if (task.parentId) throw subtaskList();
        if (!isMember(list, userId)) throw notYourList();
      }

      if (restoring) {
        const result = await taskRepo.restore(id, updatedAt);
        // Read again: a task whose list was deleted came back to the Inbox, away from the
        // list's collaborators
        const restored = await taskRepo.findByIdWithAccess(id);
        broadcast(c, "tasks", "insert", await taskRepo.findListItem(id), audience(restored));
        return c.json(result, 200);
      }

      // What the client stamped wins; one from before these columns existed sends neither
      const stamps = taskChangeStamps(fields, updatedAt);
      const result = await taskRepo.update(id, updatedAt, { ...stamps, ...fields });
      broadcast(c, "tasks", "update", result, audience(task));
      if (task.parent && stamps.editedAt) await markTaskEdited(c, task.parent, userId, updatedAt);

      const notifiableFields = ["title", "description", "status", "dueDate"] as const;
      const changedNotifiable = notifiableFields.filter((f) => f in fields);
      const assigneeChanged = fields.assigneeId && fields.assigneeId !== task.assigneeId;

      if (changedNotifiable.length > 0 || assigneeChanged) {
        const actorName = await getUserName(userId);

        const allRecipients = audience(task).filter((uid) => uid !== userId);

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

      const task = await requireTask(id, userId, "delete");

      const { task: removed, subtaskIds } = await taskRepo.remove(id);
      broadcastAll(
        c,
        [removed.id, ...subtaskIds].map((removedId) => ({
          model: "tasks" as const,
          action: "delete" as const,
          data: { id: removedId },
        })),
        audience(task),
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
      broadcast(c, "tasks", "update", { id: taskId }, [userId]);
      return c.json(result, 200);
    },
  );
