import { z } from "@hono/zod-openapi";
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
import { userPublicSchema } from "../db/user.repo";
import contactRepo from "../db/contact.repo";
import { BadRequestError, NotFoundError, ONLY_CONTACTS } from "../db/errors";
import { authed, authedRoute } from "../middleware";
import { broadcast } from "../broadcast";
import { sendNotification, getUserName } from "../notify";
import { jsonBody } from "./crud";
import { MAX_USERNAME } from "@newtab-todo/shared/field-limits";
import { limitSharing } from "../rate-limit";

const collaboratorSchema = z.object({
  username: z.string().min(1, "Choose someone to share with.").max(MAX_USERNAME, ONLY_CONTACTS),
});
const collaboratorIdSchema = z.object({ userId: z.string() });

export const categoryRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(categoryResponseSchema) },
    }),
    async (c) => c.json(await categoryRepo.list(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(categoryInsertSchema),
      responses: { 200: categoryResponseSchema, 409: true },
    }),
    async (c) => {
      const userId = c.get("userId");
      const result = await categoryRepo.insert({ ...c.req.valid("json"), userId });
      broadcast(c, "categories", "insert", result, [userId]);
      return c.json(result, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/",
      request: jsonBody(categoryUpdateSchema),
      responses: { 200: categoryResponseSchema, 403: true, 404: true, 409: true },
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
    authedRoute({
      method: "delete",
      path: "/",
      request: jsonBody(categoryDeleteSchema),
      responses: { 200: categoryResponseSchema, 400: true, 403: true, 404: true },
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
    authedRoute({
      method: "post",
      path: "/:id/restore",
      responses: { 200: categoryResponseSchema, 403: true, 404: true },
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
    authedRoute({
      method: "get",
      path: "/:id/collaborators",
      responses: { 200: z.array(userPublicSchema), 403: true, 404: true },
    }),
    async (c) => {
      const { id } = c.req.param();
      const [, cat] = await Promise.all([
        requireList(id, c.get("userId"), "manage"),
        categoryRepo.findByIdWithCollaborators(id),
      ]);

      return c.json(
        cat.collaborators.map((c) => c.user),
        200,
      );
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/:id/collaborators",
      request: jsonBody(collaboratorSchema),
      responses: { 200: userPublicSchema, 400: true, 403: true, 404: true, 429: true },
    }),
    async (c) => {
      const { id } = c.req.param();
      const userId = c.get("userId");
      const { username } = c.req.valid("json");

      limitSharing(userId);
      const [cat, targetUser] = await Promise.all([
        requireList(id, userId, "manage"),
        contactRepo.findContactUser(userId, username.toLowerCase()),
      ]);
      if (!targetUser) throw new BadRequestError(ONLY_CONTACTS);

      const before = await reachRepo.read({ listIds: [id] });
      const added = await categoryCollaboratorRepo.add(id, targetUser.id);
      if (!added) return c.json(targetUser, 200);
      await sendReachChanges(c, before);

      const actorName = await getUserName(userId);
      sendNotification(targetUser.id, {
        type: "category-shared",
        categoryId: id,
        categoryName: cat.name,
        fromUser: actorName,
      });

      return c.json(targetUser, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/:id/collaborators/:userId",
      responses: { 200: collaboratorIdSchema, 403: true, 404: true },
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
    authedRoute({
      method: "post",
      path: "/:id/collaborators/:userId/restore",
      responses: { 200: collaboratorIdSchema, 400: true, 403: true, 404: true },
    }),
    async (c) => {
      const { id, userId: targetUserId } = c.req.param();
      const userId = c.get("userId");
      await requireList(id, userId, "manage");
      if (!(await contactRepo.exists(userId, targetUserId)))
        throw new BadRequestError(
          "You can only share lists with your contacts. Invite them first.",
        );

      const { before, changed } = await categoryCollaboratorRepo.restore(id, targetUserId);
      await sendReachChanges(c, before, changed);
      return c.json({ userId: targetUserId }, 200);
    },
  );
