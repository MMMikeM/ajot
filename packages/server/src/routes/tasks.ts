import { createRoute, z } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { BadRequestError, ForbiddenError, ONLY_CONTACTS, onlyContacts } from "../db/errors";
import taskRepo, {
  taskInsertSchema,
  taskUpdateSchema,
  taskSelectSchema,
  taskShareSelectSchema,
  taskResponseSchema,
  taskShareResponseSchema,
  taskListItemSchema,
} from "../db/task.repo";
import contactRepo from "../db/contact.repo";
import categoryRepo from "../db/category.repo";
import { authed } from "../middleware";
import { broadcast, broadcastAll } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import notificationQueueRepo from "../db/notification-queue.repo";
import { errors, jsonBody, jsonContent, withAuth } from "./crud";
import reachRepo from "../db/reach.repo";
import { audienceOf, markTaskEdited, requireTask } from "./task-users";
import { sendReachChanges } from "./reach";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";
import { MAX_ID, MAX_USERNAME } from "@newtab-todo/shared/field-limits";
import { limitSharing } from "../rate-limit";

const shareSchema = z.object({
  taskId: z.string().max(MAX_ID),
  username: z.string().min(1, "Choose someone to share with.").max(MAX_USERNAME, ONLY_CONTACTS),
  permission: z.enum(["view", "edit"]).default("edit"),
});

const sendSchema = taskInsertSchema
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

const notYourList = () => new ForbiddenError("That list isn't yours.");
const notAContact = () => new BadRequestError("You can only assign tasks to your contacts.");
const subtaskGoesWithParent = () => new BadRequestError("A subtask goes wherever its parent is.");

const shareCategorySchema = z.object({
  taskId: z.string().max(MAX_ID),
  categoryId: z.string().max(MAX_ID).nullable(),
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
      responses: withAuth({ 200: jsonContent(taskResponseSchema), ...errors(400, 403, 404, 409) }),
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
      if (parent?.task.parentId) throw new BadRequestError("Subtasks can't have subtasks.");
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
      responses: withAuth({ 200: jsonContent(taskResponseSchema), ...errors(400, 403, 404, 409) }),
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");

      const restoring = fields.deletedAt === null;
      const [{ task, mine, audience }, canUseList, mayAssign] = await Promise.all([
        // As with deleting, only the owner can bring a task back
        requireTask(id, userId, restoring ? "manage" : "edit", { deleted: restoring }),
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
      const moving = "categoryId" in fields ? await reachRepo.read({ taskIds: [id] }) : undefined;
      const result = await taskRepo.update(id, updatedAt, { ...stamps, ...fields });
      if (moving) await sendReachChanges(c, moving, [id]);
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
              fromUser: actorName,
              changes: changeDescriptions.join(", "),
            });
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
      responses: withAuth({ 200: jsonContent(taskResponseSchema), ...errors(403, 404) }),
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
    createRoute({
      method: "post",
      path: "/send",
      request: jsonBody(sendSchema),
      responses: withAuth({ 200: jsonContent(taskResponseSchema), ...errors(400, 404, 409, 429) }),
    }),
    async (c) => {
      const { recipientId, ...data } = c.req.valid("json");
      const userId = c.get("userId");
      limitSharing(userId);
      if (!(await contactRepo.exists(userId, recipientId)))
        throw new BadRequestError("You can only send tasks to your contacts.");

      // The recipient owns it, as if they'd added it, so it lands in their Inbox and not the sender's
      const result = await taskRepo.insertSent({
        ...data,
        userId: recipientId,
        sentById: userId,
        sortOrder: await taskRepo.nextSortOrder(recipientId),
      });
      // As the list sends it, so the recipient's devices can say who sent it, offline too
      broadcast(c, "tasks", "insert", await taskRepo.findListItem(result.id), [recipientId]);

      const actorName = await getUserName(userId);
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
    createRoute({
      method: "post",
      path: "/share",
      request: jsonBody(shareSchema),
      responses: withAuth({
        200: jsonContent(taskShareResponseSchema),
        ...errors(400, 403, 404, 429),
      }),
    }),
    async (c) => {
      const data = c.req.valid("json");
      const userId = c.get("userId");
      limitSharing(userId);
      const [{ task }, targetUser] = await Promise.all([
        requireTask(data.taskId, userId, "manage"),
        contactRepo.findContactUser(userId, data.username.toLowerCase()),
      ]);
      if (task.parentId) throw subtaskGoesWithParent();
      if (!targetUser) throw onlyContacts();

      const before = await reachRepo.read({ taskIds: [task.id] });
      const {
        share: result,
        added,
        changed,
      } = await taskRepo.insertShare({
        id: createId(),
        taskId: task.id,
        sharedWithUserId: targetUser.id,
        permission: data.permission,
      });
      if (!changed) return c.json(result, 200);
      await sendReachChanges(c, before, [task.id]);
      // A new permission on a share they already had isn't news to them
      if (!added) return c.json(result, 200);

      const actorName = await getUserName(userId);
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
    createRoute({
      method: "delete",
      path: "/share",
      request: jsonBody(taskShareSelectSchema),
      responses: withAuth({ 200: jsonContent(taskShareResponseSchema), ...errors(403, 404) }),
    }),
    async (c) => {
      const share = await taskRepo.findShare(c.req.valid("json").id);
      // Someone who can't see the task gets the same 404 as for a share that doesn't exist
      await requireTask(share.taskId, c.get("userId"), "manage");
      const before = await reachRepo.read({ taskIds: [share.taskId] });
      const result = await taskRepo.removeShare(share.id);
      await sendReachChanges(c, before, [share.taskId]);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/share",
      request: jsonBody(shareCategorySchema),
      responses: withAuth({ 200: jsonContent(taskShareResponseSchema), ...errors(403, 404) }),
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
