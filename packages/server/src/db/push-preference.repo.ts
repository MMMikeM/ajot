import { createInsertSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { PUSH_TRIGGERS, type PushTrigger } from "@newtab-todo/shared/push-payload";
import { db } from "./client";
import { pushPreferences } from "./schema";

export const pushPreferencesSchema = createInsertSchema(pushPreferences, {
  muted: z.array(z.enum(PUSH_TRIGGERS)),
}).pick({ muted: true });

export type PushPreferences = z.infer<typeof pushPreferencesSchema>;

const find = async (userId: string, deviceId: string): Promise<PushPreferences> => {
  const row = await db.query.pushPreferences.findFirst({ where: { userId, deviceId } });
  return { muted: row?.muted ?? [] };
};

const save = async (userId: string, deviceId: string, { muted }: PushPreferences) => {
  await db
    .insert(pushPreferences)
    .values({ userId, deviceId, muted })
    .onConflictDoUpdate({
      target: [pushPreferences.userId, pushPreferences.deviceId],
      set: { muted },
    });
};

/** What each of these users' devices has muted, keyed by `mutedKey`. */
const findMutedForUsers = async (userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, PushTrigger[]>();
  const rows = await db.query.pushPreferences.findMany({ where: { userId: { in: userIds } } });
  return new Map(rows.map((row) => [mutedKey(row.userId, row.deviceId), row.muted]));
};

export const mutedKey = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

export default { find, save, findMutedForUsers };
