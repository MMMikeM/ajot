import { createRoute, z } from "@hono/zod-openapi";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import inviteTokenRepo from "../db/invite-token.repo";
import { BadRequestError, GoneError, INVITE_GONE } from "../db/errors";
import { getUserName, sendNotification } from "../notify";
import { sendContactChanges } from "./contact-changes";
import { authed } from "../middleware";
import { errorSchema } from "./openapi-schemas";
import { errors, jsonContent, okBody, okResponse, withAuth } from "./crud";

const inviteResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export const inviteRoutes = authed()
  .openapi(
    createRoute({
      method: "post",
      path: "/",
      responses: withAuth({ 200: jsonContent(inviteResponseSchema) }),
    }),
    async (c) => {
      const userId = c.get("userId");
      const expiresAt = hoursFromNow(7 * 24);
      const invite = await inviteTokenRepo.create(userId, expiresAt);
      return c.json({ token: invite.id, expiresAt: invite.expiresAt }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/:token/accept",
      responses: withAuth({
        ...okResponse,
        ...errors(400),
        410: jsonContent(errorSchema, "Token expired or already used"),
      }),
    }),
    async (c) => {
      const { token } = c.req.param();
      const userId = c.get("userId");

      // Claimed in one statement, so two accepts racing on the same link can't both pass
      const invite = await inviteTokenRepo.claim(token);
      if (!invite) throw new GoneError(INVITE_GONE);
      if (invite.createdByUserId === userId) {
        await inviteTokenRepo.release(invite.id);
        throw new BadRequestError("That's your own invite. Send it to someone else.");
      }

      let added;
      try {
        added = await inviteTokenRepo.consume(invite, userId);
      } catch (e) {
        await inviteTokenRepo.release(invite.id);
        throw e;
      }
      await sendContactChanges(c, { addedIds: added.map((row) => row.id) });

      sendNotification(invite.createdByUserId, {
        type: "contact-accepted",
        contactName: await getUserName(userId),
      });

      return c.json(okBody, 200);
    },
  );
