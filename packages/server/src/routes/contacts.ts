import { createRoute, z } from "@hono/zod-openapi";
import contactRepo, { contactResponseSchema } from "../db/contact.repo";
import { sendReachChanges } from "./reach";
import { sendContactChanges } from "./contact-changes";
import { authed } from "../middleware";
import { res } from "./crud";

export const contactRoutes = authed()
  .openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: res({ ok: z.array(contactResponseSchema) }),
    }),
    async (c) => c.json(await contactRepo.list(c.get("userId")), 200),
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/:id",
      responses: res({ ok: z.object({ id: z.string() }), errors: [404] }),
    }),
    async (c) => {
      const { id } = c.req.param();
      const { contact, removed, before, changed } = await contactRepo.remove(id, c.get("userId"));
      await Promise.all([sendContactChanges(c, { removed }), sendReachChanges(c, before, changed)]);
      return c.json({ id: contact.id }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:id/restore",
      responses: res({ ok: z.object({ id: z.string() }), errors: [404] }),
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
