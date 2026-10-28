import { and, eq, lt } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { users } from "./schema";
import { InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";

/** What other users may see of someone: never the password hash. */
export const userPublicSchema = createSelectSchema(users).pick({
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
});

export type UserInsert = typeof users.$inferInsert;

const list = async (_userId: string) =>
  db.query.users.findMany({
    orderBy: { name: "asc" },
    columns: { passwordHash: false },
  });

/** Undefined for an account that's gone: what reads a name falls back, rather than refusing. */
const findById = async (id: string) =>
  db.query.users.findFirst({ where: { id }, columns: { passwordHash: false } });

const findByUsername = async (username: string) => {
  const row = await db.query.users.findFirst({
    where: { username },
    columns: { passwordHash: false },
  });
  if (!row) throw new NotFoundError("username");
  return row;
};

/** For signing in; undefined when no one has the username, which isn't logged. */
const findWithPassword = async (username: string) =>
  db.query.users.findFirst({ where: { username } });

const exists = async (username: string) =>
  (await db.query.users.findFirst({ where: { username }, columns: { id: true } })) !== undefined;

const count = () => db.$count(users);

const insert = async (data: UserInsert) => {
  const [row] = await db.insert(users).values(data).returning();
  if (!row) throw new InsertFailedError("user");
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<UserInsert>) => {
  const [row] = await db
    .update(users)
    .set({ ...fields, updatedAt })
    .where(and(eq(users.id, id), lt(users.updatedAt, updatedAt)))
    .returning();
  if (!row) throw new StaleUpdateError("user", id);
  return row;
};

const remove = async (id: string) => {
  const [row] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!row) throw new NotFoundError("user", id);
  return row;
};

export default {
  list,
  findById,
  findByUsername,
  findWithPassword,
  exists,
  count,
  insert,
  update,
  remove,
};
