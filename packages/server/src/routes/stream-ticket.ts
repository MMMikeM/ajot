import { z } from "@hono/zod-openapi";
import { authed, authedRoute } from "../middleware";
import { issueTicket } from "../stream-tickets";

export const streamTicketRoutes = authed().openapi(
  authedRoute({
    method: "post",
    path: "/",
    responses: { 200: z.object({ ticket: z.string() }) },
  }),
  (c) => c.json({ ticket: issueTicket(c.get("userId")) }, 200),
);
