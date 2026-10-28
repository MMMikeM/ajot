import type { z } from "@hono/zod-openapi";

/**
 * Lengths a request's fields may run to. Far above what anyone types: the client drops a change
 * the server refuses rather than retrying it, so a real one must never be refused. And small enough
 * that a whole request still fits the body limit (app.ts) at four bytes a character.
 */
export const MAX_ID = 100;
export const MAX_TITLE = 1_000;
export const MAX_TEXT = 50_000;
export const MAX_NAME = 200;
export const MAX_SHORT = 100;
export const MAX_USERNAME = 100;
export const MAX_PASSWORD = 1_000;
// A list delete names the tasks it was shown
export const MAX_TASK_IDS = 5_000;

const count = (n: number) => n.toLocaleString("en");

/** A string field of at most `max` characters, refused in words a person can act on. */
export const limited = (what: string, max: number) => (schema: z.ZodString) =>
  schema.max(max, `${what} can be at most ${count(max)} characters.`);

/** An id the client made, which no person types. */
export const limitedId = (schema: z.ZodString) => schema.max(MAX_ID);
