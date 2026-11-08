import { z } from "@hono/zod-openapi";
import { MAX_NAME } from "@newtab-todo/shared/field-limits";
import { MCP_TOKEN_DAYS } from "@newtab-todo/shared/constants";
import * as mcpTokenRepo from "../db/mcp-token.repo";
import { BadRequestError } from "../db/errors";
import { authed, authedRoute } from "../middleware";
import { limitMcpTokens } from "../rate-limit";
import { jsonBody } from "./crud";

const MAX_LIVE_TOKENS = 20;

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name it, such as for the computer it's on.")
    .max(MAX_NAME, `A token's name can be at most ${MAX_NAME} characters.`),
  canWrite: z.boolean(),
  days: z.union(MCP_TOKEN_DAYS.map((days) => z.literal(days))),
});

export const mcpTokenRoutes = authed()
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      responses: { 200: z.array(mcpTokenRepo.listedSchema) },
    }),
    async (c) => c.json(await mcpTokenRepo.listOf(c.get("userId")), 200),
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(createSchema),
      responses: {
        200: mcpTokenRepo.listedSchema.extend({ token: z.string() }),
        400: true,
        429: true,
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      limitMcpTokens(userId);
      if ((await mcpTokenRepo.countLive(userId)) >= MAX_LIVE_TOKENS)
        throw new BadRequestError(
          `You have ${MAX_LIVE_TOKENS} tokens already. Revoke one you no longer use first.`,
        );
      return c.json(await mcpTokenRepo.create(userId, c.req.valid("json")), 200);
    },
  )
  .openapi(
    authedRoute({
      method: "delete",
      path: "/:id",
      responses: { 200: z.object({ id: z.string() }), 404: true },
    }),
    async (c) => c.json(await mcpTokenRepo.remove(c.req.param("id"), c.get("userId")), 200),
  );
