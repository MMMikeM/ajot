import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { login, signup } from "../auth-service";
import sessionRepo from "../db/session.repo";
import inviteTokenRepo from "../db/invite-token.repo";
import { extractToken, validateSession } from "../auth";
import { errorSchema, okSchema } from "./openapi-schemas";
import { jsonBody, jsonContent } from "./crud";
import { MIN_PASSWORD_LENGTH } from "../password";
import { sendNotification } from "../notify";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const signupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
  name: z.string().min(1, "Name is required"),
  invite: z.string().optional(),
});

const authResponseSchema = z.object({
  userId: z.string(),
  token: z.string(),
  name: z.string(),
  username: z.string(),
});

const inviterSchema = z.object({ inviterName: z.string() });

export const authRoutes = new OpenAPIHono()
  .openapi(
    createRoute({
      method: "post",
      path: "/login",
      request: jsonBody(loginSchema),
      responses: {
        200: jsonContent(authResponseSchema),
        401: jsonContent(errorSchema, "Login failed"),
      },
    }),
    async (c) => {
      const data = c.req.valid("json");
      console.log(`[login] attempt username=${data.username}`);
      try {
        const result = await login(data.username, data.password);
        console.log(`[login] success username=${data.username} userId=${result.userId}`);
        return c.json(result, 200);
      } catch (e) {
        console.log(
          `[login] failed username=${data.username} error=${e instanceof Error ? e.message : String(e)}`,
        );
        throw e;
      }
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/signup",
      request: jsonBody(signupSchema),
      responses: {
        200: jsonContent(authResponseSchema),
        403: jsonContent(errorSchema, "No invite, or the invite is no longer valid"),
        409: jsonContent(errorSchema, "Conflict"),
      },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const { session, invitedBy } = await signup(
        data.username,
        data.password,
        data.name,
        data.invite,
      );
      if (invitedBy) {
        sendNotification(invitedBy, { type: "contact-accepted", contactName: session.name }).catch(
          () => {},
        );
      }
      return c.json(session, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/invites/:token",
      responses: {
        200: jsonContent(inviterSchema),
        404: jsonContent(errorSchema, "No usable invite"),
      },
    }),
    // Before signing up, so it can't ask for a session. It names only the inviter, and an
    // invite that's unknown, used or expired answers the same way.
    async (c) => {
      const inviterName = await inviteTokenRepo.findInviterName(c.req.param("token"));
      if (!inviterName) throw new HTTPException(404, { message: "Invite not found" });
      return c.json({ inviterName }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/logout",
      responses: {
        200: jsonContent(okSchema),
        401: jsonContent(errorSchema, "Unauthorized"),
      },
    }),
    async (c) => {
      const token = extractToken(c.req.raw);
      if (!token) throw new HTTPException(401, { message: "Unauthorized" });
      const userId = await validateSession(token);
      await sessionRepo.removeAllForUser(userId);
      return c.json({ ok: true as const }, 200);
    },
  );
