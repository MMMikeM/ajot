import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { UNAUTHORIZED } from "../db/errors";
import { authed, authedRoute } from "../middleware";
import { issueTicket } from "../stream-tickets";

export const streamTicketRoutes = authed().openapi(
  authedRoute({
    method: "post",
    path: "/",
    responses: { 200: z.object({ ticket: z.string() }) },
  }),
  // Only a sign-in's stream can be closed by signing out
  (c) => {
    const sessionId = c.get("sessionId");
    if (!sessionId) throw new HTTPException(401, { message: UNAUTHORIZED });
    return c.json({ ticket: issueTicket({ userId: c.get("userId"), sessionId }) }, 200);
  },
);
