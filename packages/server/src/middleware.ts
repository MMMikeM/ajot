import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { extractToken, validateSession } from "./auth";
import { route, type RouteOf, type ShorthandRoute } from "./routes/crud";
import { ForbiddenError, UNAUTHORIZED } from "./db/errors";
import { mayCall, type McpCaller } from "./mcp/caller";

export type AuthEnv = { Bindings: { mcpCaller?: McpCaller }; Variables: { userId: string } };

const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const caller = c.env?.mcpCaller;
  if (caller) {
    if (!mayCall(caller, c.req.method, c.req.path))
      throw new ForbiddenError("An MCP token can't do that.");
    c.set("userId", caller.userId);
    return next();
  }
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

type WithAuth<R extends ShorthandRoute> = Omit<R, "responses"> & {
  responses: Omit<{ 401: true }, keyof R["responses"]> & R["responses"];
};

export const authedRoute = <const R extends ShorthandRoute>(spec: R) =>
  route({ ...spec, responses: { 401: true, ...spec.responses } }) as unknown as NoInfer<
    RouteOf<WithAuth<R>>
  >;
