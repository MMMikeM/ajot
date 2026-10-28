import { OpenAPIHono, createRoute, type RouteConfig } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { extractToken, validateSession } from "./auth";
import { unauthorizedResponse } from "./routes/openapi-schemas";
import { UNAUTHORIZED } from "./db/errors";

export type AuthEnv = { Variables: { userId: string } };

const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = extractToken(c.req.raw);
  if (!token) throw new HTTPException(401, { message: UNAUTHORIZED });
  c.set("userId", await validateSession(token));
  await next();
};

export const authed = () => {
  const app = new OpenAPIHono<AuthEnv>();
  app.use(authMiddleware);
  return app;
};

/** A route on an `authed()` router: it also answers the middleware's 401, before its handler runs. */
export const authedRoute = <const R extends RouteConfig>(route: R) =>
  createRoute({ ...route, responses: { ...route.responses, 401: unauthorizedResponse } });
