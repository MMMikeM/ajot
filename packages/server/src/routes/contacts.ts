import { createRoute, z } from "@hono/zod-openapi";
import contactRepo, { contactResponseSchema } from "../db/contact.repo";
import type { Context } from "hono";
import categoryRepo from "../db/category.repo";
import { broadcastPerUser } from "../broadcast";
import { authed } from "../middleware";
import { errorSchema } from "./openapi-schemas";
import { jsonContent, withAuth } from "./crud";

export const contactRoutes = authed()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: withAuth({ 200: jsonContent(z.array(contactResponseSchema)) }),
    }),
    async (c) => c.json(await contactRepo.list(c.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/:id",
      responses: withAuth({
        200: jsonContent(z.object({ id: z.string() })),
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const { contact, collaborators } = await contactRepo.remove(id, c.get("userId"));
      await broadcastSharing(c, "delete", collaborators);
      return c.json({ id: contact.id }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:id/restore",
      responses: withAuth({
        200: jsonContent(z.object({ id: z.string() })),
        404: jsonContent(errorSchema, "Not found"),
      }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const { contact, collaborators } = await contactRepo.restore(id, c.get("userId"));
      await broadcastSharing(c, "insert", collaborators);
      return c.json({ id: contact.id }, 200);
    },
  );

/**
 * Tells each collaborator their list went or came back, and each owner who it's now shared
 * with. Contacts themselves have no live sync: each device reads them again when it refetches.
 */
const broadcastSharing = async (
  c: Context,
  action: "insert" | "delete",
  collaborators: { categoryId: string; userId: string }[],
) => {
  const lists = await categoryRepo.listByIds([...new Set(collaborators.map((r) => r.categoryId))]);
  broadcastPerUser(c, [
    ...lists.map((list) => ({
      userId: list.userId,
      event: { model: "categories" as const, action: "update" as const, data: list },
    })),
    ...collaborators.map(({ categoryId, userId }) => {
      const list = lists.find((l) => l.id === categoryId);
      return {
        userId,
        event:
          action === "insert" && list
            ? { model: "categories" as const, action, data: list }
            : { model: "categories" as const, action: "delete" as const, data: { id: categoryId } },
      };
    }),
  ]);
};
