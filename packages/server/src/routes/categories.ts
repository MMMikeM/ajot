import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import categoryRepo, {
  categoryInsertSchema,
  categoryUpdateSchema,
  categoryDeleteSchema,
  categoryResponseSchema,
} from "../db/category.repo";
import categoryCollaboratorRepo from "../db/category-collaborator.repo";
import taskRepo from "../db/task.repo";
import userRepo, { userPublicSchema } from "../db/user.repo";
import contactRepo from "../db/contact.repo";
import { authed } from "../middleware";
import { broadcast, broadcastPerUser, type BroadcastEvent } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import { errorSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";

type TaskEvent = BroadcastEvent & { model: "tasks"; data: { id: string } };

// Each task's event goes only to the people task_access says can reach it, once each
const toReach = (access: { taskId: string; userId: string }[], events: TaskEvent[]) =>
  events.flatMap((event) =>
    [...new Set(access.filter((a) => a.taskId === event.data.id).map((a) => a.userId))].map(
      (userId) => ({ userId, event }),
    ),
  );

const collaboratorSchema = z.object({ username: z.string().min(1) });
const collaboratorIdSchema = z.object({ userId: z.string() });

export const categoryRoutes = authed()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: withAuth({ 200: jsonContent(z.array(categoryResponseSchema)) }),
    }),
    async (c) => c.json(await categoryRepo.list(c.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/",
      request: jsonBody(categoryInsertSchema),
      responses: withAuth({ 200: jsonContent(categoryResponseSchema) }),
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await categoryRepo.insert({ ...c.req.valid("json"), userId });
      broadcast(c, "categories", "insert", result, [userId]);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/",
      request: jsonBody(categoryUpdateSchema),
      responses: withAuth({
        200: jsonContent(categoryResponseSchema),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");

      const [cat, memberIds] = await Promise.all([
        categoryRepo.findById(id),
        categoryRepo.memberIds(id),
      ]);
      if (cat.userId !== userId) throw new HTTPException(403, { message: "Not authorized" });

      const result = await categoryRepo.update(id, updatedAt, fields);
      broadcast(c, "categories", "update", result, memberIds);
      return c.json(result, 200);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/",
      request: jsonBody(categoryDeleteSchema),
      responses: withAuth({
        200: jsonContent(categoryResponseSchema),
        400: jsonContent(errorSchema, "Bad request"),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { id, tasks: taskAction, taskIds } = c.req.valid("json");
      const userId = c.get("userId");

      // Read before the delete: afterwards the list reaches no one
      const [cat, memberIds, reach] = await Promise.all([
        categoryRepo.findById(id),
        categoryRepo.memberIds(id),
        taskRepo.accessToList(id),
      ]);
      if (cat.userId !== userId) throw new HTTPException(403, { message: "Not authorized" });

      const { category, deletedIds, movedTasks, unfiledShares } =
        await categoryRepo.removeWithTasks(id, taskAction, taskIds);

      const taskEvents: TaskEvent[] = [
        ...deletedIds.map((taskId) => ({
          model: "tasks" as const,
          action: "delete" as const,
          data: { id: taskId },
        })),
        ...movedTasks.map((task) => ({
          model: "tasks" as const,
          action: "update" as const,
          data: task,
        })),
      ];
      const reached = new Set(reach.map((a) => a.taskId));
      const addedSinceRead = taskEvents.map((e) => e.data.id).filter((id) => !reached.has(id));
      const reachSinceRead = await taskRepo.accessTo(addedSinceRead);
      broadcastPerUser(c, toReach([...reach, ...reachSinceRead], taskEvents));
      broadcast(c, "categories", "delete", { id: category.id }, memberIds);

      // Whoever filed a shared task here would otherwise keep seeing it under the deleted
      // category on their other devices
      const deleted = new Set(deletedIds);
      const unfiled = unfiledShares.filter((s) => !deleted.has(s.taskId));
      const unfiledTasks = await taskRepo.listSharesForTasks([
        ...new Set(unfiled.map((s) => s.taskId)),
      ]);
      const sharesByTask = new Map(unfiledTasks.map((t) => [t.id, t.shares]));
      broadcastPerUser(
        c,
        unfiled.map((s) => ({
          userId: s.sharedWithUserId,
          event: {
            model: "tasks" as const,
            action: "update" as const,
            data: { id: s.taskId, shares: sharesByTask.get(s.taskId) ?? [] },
          },
        })),
      );

      return c.json(category, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:id/restore",
      responses: withAuth({
        200: jsonContent(categoryResponseSchema),
        403: jsonContent(errorSchema, "Forbidden"),
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const { category, restoredIds, movedBack, refiled, memberIds } = await categoryRepo.restore(
        id,
        c.get("userId"),
      );
      broadcast(c, "categories", "insert", category, memberIds);

      const backIds = [...restoredIds, ...movedBack.map((t) => t.id)];
      const [backTasks, reach] = await Promise.all([
        taskRepo.findListItems(backIds),
        taskRepo.accessTo(backIds),
      ]);
      const back = new Set(backTasks.map((t) => t.id));
      const refiledTasks = await taskRepo.listSharesForTasks([
        ...new Set(refiled.filter((s) => !back.has(s.taskId)).map((s) => s.taskId)),
      ]);
      const sharesOf = new Map(refiledTasks.map((t) => [t.id, t.shares]));
      broadcastPerUser(c, [
        ...toReach(
          reach,
          backTasks.map((task) => ({ model: "tasks", action: "insert", data: task })),
        ),
        ...refiled
          .filter((s) => sharesOf.has(s.taskId))
          .map((s) => ({
            userId: s.sharedWithUserId,
            event: {
              model: "tasks" as const,
              action: "update" as const,
              data: { id: s.taskId, shares: sharesOf.get(s.taskId) },
            },
          })),
      ]);

      return c.json(category, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/:id/collaborators",
      responses: withAuth({
        200: jsonContent(z.array(userPublicSchema)),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const userId = c.get("userId");

      const cat = await categoryRepo.findByIdWithCollaborators(id);
      if (cat.userId !== userId) throw new HTTPException(403, { message: "Not authorized" });

      return c.json(
        cat.collaborators.flatMap((c) =>
          c.user
            ? [
                {
                  id: c.user.id,
                  name: c.user.name,
                  username: c.user.username,
                  avatarUrl: c.user.avatarUrl,
                },
              ]
            : [],
        ),
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:id/collaborators",
      request: jsonBody(collaboratorSchema),
      responses: withAuth({
        200: jsonContent(userPublicSchema),
        400: jsonContent(errorSchema, "Bad request"),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const userId = c.get("userId");
      const { username } = c.req.valid("json");

      const [cat, targetUser] = await Promise.all([
        categoryRepo.findById(id),
        userRepo.findByUsername(username.toLowerCase()),
      ]);

      if (cat.userId !== userId)
        throw new HTTPException(403, { message: "Only the list's owner can share it." });
      if (targetUser.id === userId)
        throw new HTTPException(400, { message: "That's you. Choose someone else." });

      const isContact = await contactRepo.exists(userId, targetUser.id);
      if (!isContact)
        throw new HTTPException(400, {
          message: "You can only share lists with your contacts. Invite them first.",
        });

      await categoryCollaboratorRepo.add(id, targetUser.id);

      const actorName = await getUserName(userId);
      sendNotification(targetUser.id, {
        type: "category-shared",
        categoryId: id,
        categoryName: cat.name,
        fromUser: actorName,
      }).catch(() => {});

      return c.json(
        {
          id: targetUser.id,
          name: targetUser.name,
          username: targetUser.username,
          avatarUrl: targetUser.avatarUrl,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/:id/collaborators/:userId",
      responses: withAuth({
        200: jsonContent(collaboratorIdSchema),
        403: jsonContent(errorSchema, "Forbidden"),
      }),
    }),
    async (c) => {
      const { id, userId: targetUserId } = c.req.param();
      const userId = c.get("userId");
      const isSelf = targetUserId === userId;

      const cat = await categoryRepo.findById(id);
      if (cat.userId !== userId && !isSelf)
        throw new HTTPException(403, { message: "Not authorized" });

      await categoryCollaboratorRepo.remove(id, targetUserId);
      // Notify the removed user so the category disappears from their collection
      broadcast(c, "categories", "delete", { id }, [targetUserId]);
      return c.json({ userId: targetUserId }, 200);
    },
  );
