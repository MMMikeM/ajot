import { sql } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { metricCounts } from "./schema";

export const nameSchema = z.string().regex(/^[a-z0-9:-]{1,64}$/);
export const countSchema = createSelectSchema(metricCounts);

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

export const increment = async (name: string) => {
  await db
    .insert(metricCounts)
    .values({ name, day: utcDay(), count: 1 })
    .onConflictDoUpdate({
      target: [metricCounts.name, metricCounts.day],
      set: { count: sql`${metricCounts.count} + 1` },
    });
};

export const listSince = (days: number) => {
  const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
  return db.query.metricCounts.findMany({
    where: { day: { gte: since } },
    orderBy: { day: "desc", name: "asc" },
  });
};
