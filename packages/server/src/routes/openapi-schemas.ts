import { z, type Hook } from "@hono/zod-openapi";
import type { Env } from "hono";

export const errorSchema = z.object({ error: z.string() });
export const okSchema = z.object({ ok: z.literal(true) });

/** The client shows the first issue's message, so a schema a person can trip words it for them. */
export const rejectInvalidInput: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (result.success) return;
  const { issues } = result.error;
  console.warn(`[validation] ${c.req.method} ${c.req.path}`, JSON.stringify(issues));
  return c.json({ error: issues[0]?.message ?? "Something in that request wasn't valid." }, 400);
};
