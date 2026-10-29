import type { z } from "@hono/zod-openapi";
import { MAX_ID } from "@newtab-todo/shared/field-limits";

const count = (n: number) => n.toLocaleString("en");

// The database's CHECKs count code points, as length() does, so a row the migration cut to fit
// one has up to twice as many UTF-16 units, and an edit of it must still be let through
const codePoints = (text: string) => {
  let n = 0;
  for (const _ of text) n++;
  return n;
};

export const limited = (what: string, max: number) => (schema: z.ZodString) =>
  schema.refine(
    (text) => text.length <= max || codePoints(text) <= max,
    `${what} can be at most ${count(max)} characters.`,
  );

/** An id the client made, which no person types. */
export const limitedId = (schema: z.ZodString) => schema.max(MAX_ID);
