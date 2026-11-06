import { sql } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { metricCounts } from "./schema";

export const nameSchema = z.string().regex(/^[a-z0-9:-]{1,64}$/);

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/** Adds each count to today's total for its name, in one statement. */
export const add = async (counts: ReadonlyMap<string, number>) => {
  if (counts.size === 0) return;
  const day = utcDay();
  await db
    .insert(metricCounts)
    .values([...counts].map(([name, count]) => ({ name, day, count })))
    .onConflictDoUpdate({
      target: [metricCounts.name, metricCounts.day],
      set: { count: sql`${metricCounts.count} + excluded.count` },
    });
};

// Any signed-in account can send any name, so a day takes this many before it stops taking new
// ones; names it already has keep counting
export const MAX_NAMES_A_DAY = 500;

/** Counts one for `name` today, unless it's new and today already holds `MAX_NAMES_A_DAY`. */
export const incrementIfRoom = async (name: string) => {
  const day = utcDay();
  await db.run(sql`
    INSERT INTO ${metricCounts} (name, day, count)
    SELECT ${name}, ${day}, 1
    WHERE EXISTS (SELECT 1 FROM ${metricCounts} WHERE name = ${name} AND day = ${day})
      OR (SELECT count(*) FROM ${metricCounts} WHERE day = ${day}) < ${MAX_NAMES_A_DAY}
    ON CONFLICT (name, day) DO UPDATE SET "count" = "count" + 1
  `);
};
