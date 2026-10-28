import { z } from "@hono/zod-openapi";
import contactRepo, { contactResponseSchema } from "../db/contact.repo";
import { sendReachChanges } from "./reach";
import { sendContactChanges } from "./contact-changes";
import { authed, authedRoute } from "../middleware";

export const contactRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(contactResponseSchema) },
    }),
    async (c) => c.json(await contactRepo.list(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/:id",
      responses: { 200: z.object({ id: z.string() }), 404: true },
    }),
    async (c) => {
      const { id } = c.req.param();
      const { contact, removed, before, changed } = await contactRepo.remove(id, c.get("userId"));
      await Promise.all([sendContactChanges(c, { removed }), sendReachChanges(c, before, changed)]);
      return c.json({ id: contact.id }, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/:id/restore",
      responses: { 200: z.object({ id: z.string() }), 404: true },
    }),
    async (c) => {
      const { id } = c.req.param();
      const { contact, restored, before, changed } = await contactRepo.restore(id, c.get("userId"));
      await Promise.all([
        sendContactChanges(c, { addedIds: restored.map((row) => row.id) }),
        sendReachChanges(c, before, changed),
      ]);
      return c.json({ id: contact.id }, 200);
    },
  );
