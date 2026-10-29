import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { users } from "./schema";
import { InsertFailedError } from "./errors";

/** What other users may see of someone: never the password hash. */
export const publicSchema = createSelectSchema(users).pick({
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
});

export type Insert = typeof users.$inferInsert;

/** Undefined for an account that's gone: what reads a name falls back, rather than refusing. */
export const findName = async (id: string) =>
  (await db.query.users.findFirst({ where: { id }, columns: { name: true } }))?.name;

/** For signing in; undefined when no one has the username, which isn't logged. */
export const findWithPassword = async (username: string) =>
  db.query.users.findFirst({ where: { username } });

export const exists = async (username: string) =>
  (await db.query.users.findFirst({ where: { username }, columns: { id: true } })) !== undefined;

export const count = () => db.$count(users);

export const insert = async (data: Insert) => {
  const [row] = await db.insert(users).values(data).returning();
  if (!row) throw new InsertFailedError("user");
  return row;
};
