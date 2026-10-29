import { and, eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createInsertSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { pushSubscriptions } from "./schema";

export const insertSchema = createInsertSchema(pushSubscriptions)
  .omit({ createdAt: true, id: true })
  .required();

export type Insert = z.infer<typeof insertSchema>;

export const upsert = async (data: Insert) => {
  await db
    .insert(pushSubscriptions)
    .values({ id: createId(), ...data })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: data });
};

export const removeOwn = async (endpoint: string, userId: string) => {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
};

export const removeMany = async (endpoints: string[]) => {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
};

type PushSubscriptionKind = (typeof pushSubscriptions.$inferSelect)["kind"];

export const findForUsers = async (userIds: string[], kind?: PushSubscriptionKind) => {
  if (userIds.length === 0) return [];
  return db.query.pushSubscriptions.findMany({ where: { kind, userId: { in: userIds } } });
};

export const findByKind = async (kind: PushSubscriptionKind) =>
  db.query.pushSubscriptions.findMany({ where: { kind } });
