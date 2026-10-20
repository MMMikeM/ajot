import { eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createInsertSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { pushSubscriptions } from "./schema";

export const pushSubscriptionInsertSchema = createInsertSchema(pushSubscriptions)
  .omit({ createdAt: true, id: true })
  .required();

export type PushSubscriptionInsert = z.infer<typeof pushSubscriptionInsertSchema>;

const upsert = async (data: PushSubscriptionInsert) => {
  await db
    .insert(pushSubscriptions)
    .values({ id: createId(), ...data })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: data });
};

const remove = async (endpoint: string) => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
};

const removeMany = async (endpoints: string[]) => {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
};

type PushSubscriptionKind = (typeof pushSubscriptions.$inferSelect)["kind"];

// Returns subscriptions for the given users. Rows with userId = null are legacy
// (pre-3B) — included as a safe fallback until they re-register.
const findForUsers = async (userIds: string[], kind?: PushSubscriptionKind) =>
  db.query.pushSubscriptions.findMany({
    where: { kind, OR: [{ userId: { in: userIds } }, { userId: { isNull: true } }] },
  });

const findByKind = async (kind: PushSubscriptionKind) =>
  db.query.pushSubscriptions.findMany({ where: { kind } });

export default { upsert, remove, removeMany, findForUsers, findByKind };
