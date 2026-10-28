import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { now, hoursFromNow } from "@newtab-todo/shared/iso";
import { db } from "./client";
import { sessions } from "./schema";

const TOKEN_BYTES = 32;
const SESSION_TTL_DAYS = 90;

const generateToken = () => randomBytes(TOKEN_BYTES).toString("hex");

type Session = typeof sessions.$inferSelect;

// Every authed request looks its session up, so a recent answer is reused. Fly suspends the
// machine only after minutes without traffic, so after a resume nothing is fresh: the first
// request reads the session, a read that's retried if the resumed socket is dead, before anything
// writes. Date.now(), not performance.now(): the wall clock has moved on after a resume.
const CACHE_MS = 30_000;
const CACHE_LIMIT = 1_000;
const cache = new Map<string, { session: Session; cachedAt: number }>();
// Bumped once a delete is done, so a lookup that read the row before it isn't cached after
let deletes = 0;

const isFresh = ({ session, cachedAt }: { session: Session; cachedAt: number }) =>
  Date.now() - cachedAt < CACHE_MS && session.expiresAt > now();

const remember = (token: string, session: Session) => {
  if (cache.size >= CACHE_LIMIT)
    for (const [key, entry] of cache) if (!isFresh(entry)) cache.delete(key);
  cache.set(token, { session, cachedAt: Date.now() });
};

const forget = (deleted: (session: Session) => boolean) => {
  deletes++;
  for (const [token, entry] of cache) if (deleted(entry.session)) cache.delete(token);
};

const insert = async (userId: string) => {
  const id = generateToken();
  const expiresAt = hoursFromNow(SESSION_TTL_DAYS * 24);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return id;
};

const findValid = async (token: string) => {
  const cached = cache.get(token);
  if (cached && isFresh(cached)) return cached.session;
  cache.delete(token);

  const deletesBefore = deletes;
  const session = await db.query.sessions.findFirst({
    where: { id: token, expiresAt: { gt: now() } },
  });
  if (session && deletes === deletesBefore) remember(token, session);
  return session;
};

// Forgotten even if the delete fails: one that fails in transit may still have been applied
const remove = async (token: string) => {
  try {
    await db.delete(sessions).where(eq(sessions.id, token));
  } finally {
    forget((session) => session.id === token);
  }
};

const removeAllForUser = async (userId: string) => {
  try {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  } finally {
    forget((session) => session.userId === userId);
  }
};

/** For sessions deleted by another process, as reset-password.ts does. */
const forgetUser = (userId: string) => forget((session) => session.userId === userId);

export default { insert, findValid, remove, removeAllForUser, forgetUser };
