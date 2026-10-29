import { createInsertSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { PUSH_TRIGGERS } from "@newtab-todo/shared/push-payload";
import { db } from "./client";
import { pushPreferences } from "./schema";
import { DEFAULT_PUSH_PREFERENCES, deviceKey, type DevicePreferences } from "../push-plan";

export const preferencesSchema = createInsertSchema(pushPreferences, {
  muted: z.array(z.enum(PUSH_TRIGGERS)).max(100),
  urgent: z.boolean(),
}).pick({ muted: true, urgent: true });

export type PushPreferences = z.infer<typeof preferencesSchema>;

export const find = async (userId: string, deviceId: string): Promise<PushPreferences> => {
  const row = await db.query.pushPreferences.findFirst({
    where: { userId, deviceId },
    columns: { muted: true, urgent: true },
  });
  return row ?? DEFAULT_PUSH_PREFERENCES;
};

export const save = async (userId: string, deviceId: string, preferences: PushPreferences) => {
  await db
    .insert(pushPreferences)
    .values({ userId, deviceId, ...preferences })
    .onConflictDoUpdate({
      target: [pushPreferences.userId, pushPreferences.deviceId],
      set: preferences,
    });
};

export const findForUsers = async (userIds: string[]) => {
  if (userIds.length === 0) return new Map<string, DevicePreferences>();
  const rows = await db.query.pushPreferences.findMany({ where: { userId: { in: userIds } } });
  return new Map(
    rows.map((row) => [
      deviceKey(row.userId, row.deviceId),
      { muted: row.muted, urgent: row.urgent },
    ]),
  );
};
