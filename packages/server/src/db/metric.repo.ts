import { sql } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { metricCounts } from "./schema";

export const nameSchema = z.string().regex(/^[a-z0-9:-]{1,64}$/);
export const countSchema = createSelectSchema(metricCounts);

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

export const increment = (name: string) => add(new Map([[name, 1]]));

export const listSince = (days: number) => {
  const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  return db.query.metricCounts.findMany({
    where: { day: { gte: since } },
    orderBy: { day: "desc", name: "asc" },
  });
};
