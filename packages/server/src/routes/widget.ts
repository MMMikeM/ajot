import { OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { extractToken } from "../auth";
import { UNAUTHORIZED } from "../db/errors";
import * as mcpTokenRepo from "../db/mcp-token.repo";
import * as sessionRepo from "../db/session.repo";
import * as widgetCodes from "../widget-codes";
import { okSchema } from "./openapi-schemas";
import { jsonBody, okBody, route } from "./crud";

// Made by the phone (crypto-random, base64url), so it can't be guessed
const codeSchema = z.object({
  code: z
    .string()
    .min(32)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, "That isn't a widget's code."),
});

/** The Android widget signing in through the app signed in on the same phone. */
export const widgetRoutes = new OpenAPIHono()
  .openapi(
    route({
      method: "post",
      path: "/approve",
      request: jsonBody(codeSchema),
      responses: { 200: okSchema, 401: true },
    }),
    // The session, not just the user: the widget's token goes when this sign-in does
    async (c) => {
      const token = extractToken(c.req.raw);
      const session = token ? await sessionRepo.findValid(token) : undefined;
      if (!session) throw new HTTPException(401, { message: UNAUTHORIZED });
      widgetCodes.approve(c.req.valid("json").code, session.userId, session.id);
      return c.json(okBody, 200);
    },
  )
  .openapi(
    route({
      method: "post",
      path: "/claim",
      request: jsonBody(codeSchema),
      responses: {
        200: z.object({ token: z.string() }),
        404: "Not approved, or already claimed",
      },
    }),
    // Asked again until the app approves it, so a 404 is the usual answer
    async (c) => {
      const { code } = c.req.valid("json");
      const approval = widgetCodes.take(code);
      if (!approval) return c.json({ error: "Not approved, or already claimed" }, 404);
      try {
        const token = await mcpTokenRepo.replaceWidgetToken(approval.userId, approval.sessionId);
        return c.json({ token }, 200);
      } catch (err) {
        // Kept for the widget's next try, unless the sign-in is gone (the foreign key refused it)
        widgetCodes.putBack(code, approval);
        throw err;
      }
    },
  );
