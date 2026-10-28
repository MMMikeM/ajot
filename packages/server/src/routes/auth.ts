import { OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { login, signup } from "../auth-service";
import sessionRepo from "../db/session.repo";
import inviteTokenRepo from "../db/invite-token.repo";
import { INVITE_GONE, UNAUTHORIZED } from "../db/errors";
import { extractToken } from "../auth";
import { okSchema } from "./openapi-schemas";
import { jsonBody, okBody, route } from "./crud";
import { MIN_PASSWORD_LENGTH } from "../password";
import {
  MAX_ID,
  MAX_NAME,
  MAX_NEW_USERNAME,
  MAX_PASSWORD,
  MAX_USERNAME,
} from "@newtab-todo/shared/field-limits";
import { sendNotification } from "../notify";
import { isSignedRevocation } from "../session-revocation";
import { sendContactChanges } from "./contact-changes";
import { createLimiter, limitableIp, limitsFor, refuseIfLimited } from "../rate-limit";

// Plain ASCII, so no one can sign up as a lookalike of someone else's name in another script
const USERNAME = /^[A-Za-z0-9._-]+$/;

const loginSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .max(MAX_USERNAME, "Wrong username or password."),
  password: z
    .string()
    .min(1, "Password is required")
    .max(MAX_PASSWORD, "Wrong username or password."),
});

const signupSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(MAX_NEW_USERNAME, `Username can be at most ${MAX_NEW_USERNAME} characters`)
    .regex(USERNAME, "Username can have only letters, numbers, dots, dashes and underscores"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(MAX_PASSWORD, `Password can be at most ${MAX_PASSWORD} characters`),
  name: z
    .string()
    .min(1, "Name is required")
    .max(MAX_NAME, `Name can be at most ${MAX_NAME} characters`),
  invite: z.string().max(MAX_ID, INVITE_GONE).optional(),
});

const authResponseSchema = z.object({
  userId: z.string(),
  token: z.string(),
  name: z.string(),
  username: z.string(),
});

const inviterSchema = z.object({ inviterName: z.string() });

const revocationSchema = z.object({
  userId: z.string().max(MAX_ID),
  at: z.number(),
  signature: z.string().max(MAX_ID),
});

// Each try costs an argon2 hash, 19 MiB and most of the one CPU, so a flood from one address is cut
// off whatever the usernames, and guessing one account's password from it is slowed further. Not
// from every address at once: then anyone could lock an account's owner out with wrong passwords.
const FIFTEEN_MINUTES = 15 * 60_000;
const HOUR = 60 * 60_000;
const loginsByIp = createLimiter({ limit: 20, windowMs: FIFTEEN_MINUTES });
// Cleared by signing in, so it counts the tries since the last one that worked
const loginsByIpAndUsername = createLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES });
const signupsByIp = createLimiter({ limit: 10, windowMs: HOUR });
const signupsByIpAndUsername = createLimiter({ limit: 10, windowMs: HOUR });

export const authRoutes = new OpenAPIHono()
  .openapi(
    route({
      method: "post",
      path: "/login",
      request: jsonBody(loginSchema),
      responses: { 200: authResponseSchema, 401: "Login failed", 429: true },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const ip = limitableIp(c);
      // No address holds a space, so no username can make one key read as another's
      const attempt = `${ip ?? ""} ${data.username.toLowerCase()}`;
      refuseIfLimited(
        c,
        limitsFor(loginsByIp, ip, [[loginsByIpAndUsername, attempt]]),
        "signing in",
      );
      // Counted before the password is checked, so tries sent at once are counted together
      if (ip) loginsByIp.count(ip);
      loginsByIpAndUsername.count(attempt);
      const result = await login(data.username, data.password);
      loginsByIpAndUsername.clear(attempt);
      console.log(`[login] userId=${result.userId}`);
      return c.json(result, 200);
    },
  )
  .openapi(
    route({
      method: "post",
      path: "/signup",
      request: jsonBody(signupSchema),
      responses: {
        200: authResponseSchema,
        403: "No invite, or the invite is no longer valid",
        409: true,
        429: true,
      },
    }),
    async (c) => {
      const data = c.req.valid("json");
      const ip = limitableIp(c);
      const attempt = `${ip ?? ""} ${data.username.toLowerCase()}`;
      refuseIfLimited(
        c,
        limitsFor(signupsByIp, ip, [[signupsByIpAndUsername, attempt]]),
        "signing up",
      );
      if (ip) signupsByIp.count(ip);
      signupsByIpAndUsername.count(attempt);
      const { session, invitedBy, contacts } = await signup(
        data.username,
        data.password,
        data.name,
        data.invite,
      );
      await sendContactChanges(c, { addedIds: contacts.map((row) => row.id) });
      if (invitedBy) {
        sendNotification(invitedBy, { type: "contact-accepted", contactName: session.name });
      }
      return c.json(session, 200);
    },
  )
  .openapi(
    route({
      method: "get",
      path: "/invites/:token",
      responses: { 200: inviterSchema, 404: "No usable invite" },
    }),
    // Before signing up, so it can't ask for a session. It names only the inviter, and an
    // invite that's unknown, used or expired answers the same way.
    async (c) =>
      c.json({ inviterName: await inviteTokenRepo.findInviterName(c.req.param("token")) }, 200),
  )
  .openapi(
    route({
      method: "post",
      path: "/logout",
      responses: { 200: okSchema, 401: true },
    }),
    async (c) => {
      const token = extractToken(c.req.raw);
      if (!token) throw new HTTPException(401, { message: UNAUTHORIZED });
      // Only this device's session: the account stays signed in everywhere else
      await sessionRepo.remove(token);
      return c.json(okBody, 200);
    },
  )
  .openapi(
    route({
      method: "post",
      path: "/sessions-revoked",
      hide: true,
      request: jsonBody(revocationSchema),
      responses: { 200: okSchema, 401: "Not signed with this server's database token" },
    }),
    // reset-password.ts deletes the sessions itself; this only stops this process's cache
    // vouching for them
    async (c) => {
      const revocation = c.req.valid("json");
      if (!isSignedRevocation(process.env.TURSO_AUTH_TOKEN, revocation))
        throw new HTTPException(401, { message: UNAUTHORIZED });
      sessionRepo.forgetUser(revocation.userId);
      return c.json(okBody, 200);
    },
  );
