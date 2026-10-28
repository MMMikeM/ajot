import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import categoryRepo, {
  categoryInsertSchema,
  categoryUpdateSchema,
  categoryDeleteSchema,
  categoryResponseSchema,
} from "../db/category.repo";
import categoryCollaboratorRepo from "../db/category-collaborator.repo";
import reachRepo from "../db/reach.repo";
import { requireList } from "./task-users";
import { sendReachChanges } from "./reach";
import userRepo, { userPublicSchema } from "../db/user.repo";
import contactRepo from "../db/contact.repo";
import { NotFoundError } from "../db/errors";
import { authed } from "../middleware";
import { broadcast } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import { errorSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";

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
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id, updatedAt, ...fields } = c.req.valid("json");
      const userId = c.get("userId");

      const [, memberIds] = await Promise.all([
        requireList(id, userId, "manage"),
        categoryRepo.memberIds(id),
      ]);

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
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id, tasks: taskAction, taskIds } = c.req.valid("json");
      await requireList(id, c.get("userId"), "manage");
      const { category, before, changed } = await categoryRepo.removeWithTasks(
        id,
        taskAction,
        taskIds,
      );
      await sendReachChanges(c, before, changed);
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
      await requireList(id, c.get("userId"), "manage", { deleted: true });
      const { before, changed } = await categoryRepo.restore(id);
      await sendReachChanges(c, before, changed);
      const [category] = await categoryRepo.listByIds([id]);
      if (!category) throw new NotFoundError("category", id);
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
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const [, cat] = await Promise.all([
        requireList(id, c.get("userId"), "manage"),
        categoryRepo.findByIdWithCollaborators(id),
      ]);

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
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const userId = c.get("userId");
      const { username } = c.req.valid("json");

      const [cat, targetUser] = await Promise.all([
        requireList(id, userId, "manage"),
        userRepo.findByUsername(username.toLowerCase()),
      ]);
      if (targetUser.id === userId)
        throw new HTTPException(400, { message: "That's you. Choose someone else." });

      const isContact = await contactRepo.exists(userId, targetUser.id);
      if (!isContact)
        throw new HTTPException(400, {
          message: "You can only share lists with your contacts. Invite them first.",
        });

      const before = await reachRepo.read({ listIds: [id] });
      await categoryCollaboratorRepo.add(id, targetUser.id);
      await sendReachChanges(c, before);

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
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id, userId: targetUserId } = c.req.param();
      const userId = c.get("userId");
      // A collaborator may leave; only the owner removes someone else
      await requireList(id, userId, targetUserId === userId ? "use" : "manage");

      const { before, left } = await categoryCollaboratorRepo.remove(id, targetUserId, {
        keepForUndo: targetUserId !== userId,
      });
      await sendReachChanges(c, before, [...left.movedTaskIds, ...left.unfiledTaskIds]);
      return c.json({ userId: targetUserId }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:id/collaborators/:userId/restore",
      responses: withAuth({
        200: jsonContent(collaboratorIdSchema),
        400: jsonContent(errorSchema, "Bad request"),
        403: jsonContent(errorSchema, "Forbidden"),
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id, userId: targetUserId } = c.req.param();
      const userId = c.get("userId");
      await requireList(id, userId, "manage");
      if (!(await contactRepo.exists(userId, targetUserId)))
        throw new HTTPException(400, {
          message: "You can only share lists with your contacts. Invite them first.",
        });

      const { before, changed } = await categoryCollaboratorRepo.restore(id, targetUserId);
      await sendReachChanges(c, before, changed);
      return c.json({ userId: targetUserId }, 200);
    },
  );
