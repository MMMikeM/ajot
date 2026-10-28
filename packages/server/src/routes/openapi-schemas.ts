import { z, type Hook } from "@hono/zod-openapi";
import type { Env } from "hono";
import { UNAUTHORIZED } from "../db/errors";

export const errorSchema = z.object({ error: z.string() });
export const okSchema = z.object({ ok: z.literal(true) });

export const unauthorizedResponse = {
  description: UNAUTHORIZED,
  content: { "application/json": { schema: errorSchema } },
} as const;

/**
 * Input a route's schema refuses, answered in errorSchema's shape like any other refusal, so the
 * client can show it: the first issue's message, which schemas a person can trip word for them.
 */
export const rejectInvalidInput: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return;
  const { issues } = result.error;
  console.warn(`[validation] ${c.req.method} ${c.req.path}`, JSON.stringify(issues));
  return c.json({ error: issues[0]?.message ?? "Something in that request wasn't valid." }, 400);
};
