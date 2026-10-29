import { createHash, randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { now, hoursFromNow } from "@newtab-todo/shared/iso";
import { db } from "./client";
import { sessions } from "./schema";

const TOKEN_BYTES = 32;
const SESSION_TTL_DAYS = 90;

const generateToken = () => randomBytes(TOKEN_BYTES).toString("hex");

// The row's id is the token's hash, so a copy of the database signs no one in. In base64url, which
// a token (hex) never is, so a stored id presented as a token is hashed and matches nothing.
const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

// A session not yet hashed holds the token itself, until it's next used or the purge hashes it
// (hashStoredTokens)
const RAW_TOKEN = /^[0-9a-f]{64}$/;
const storedIds = (token: string) => {
  const id = hashToken(token);
  return RAW_TOKEN.test(token) ? [id, token] : [id];
};

type Session = typeof sessions.$inferSelect;

// Fly suspends the machine only after minutes without traffic, so after a resume nothing is
// fresh: the first request reads the session, a read that's retried if the resumed socket is
// dead, before anything writes. Date.now(), not performance.now(): the wall clock has moved on
// after a resume.
const CACHE_MS = 30_000;
const CACHE_LIMIT = 1_000;
const cache = new Map<string, { session: Session; cachedAt: number }>();
// Bumped once a delete is done, so a lookup that read the row before it isn't cached after
let deletes = 0;

const isFresh = ({ session, cachedAt }: { session: Session; cachedAt: number }) =>
  Date.now() - cachedAt < CACHE_MS && session.expiresAt > now();

const remember = (id: string, session: Session) => {
  if (cache.size >= CACHE_LIMIT)
    for (const [key, entry] of cache) if (!isFresh(entry)) cache.delete(key);
  cache.set(id, { session, cachedAt: Date.now() });
};

const forget = (deleted: (session: Session) => boolean) => {
  deletes++;
  for (const [id, entry] of cache) if (deleted(entry.session)) cache.delete(id);
};

export const insert = async (userId: string) => {
  const token = generateToken();
  const expiresAt = hoursFromNow(SESSION_TTL_DAYS * 24);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return token;
};

// A failure leaves the token stored as it was, still found by storedIds
const hashStored = async (token: string) => {
  try {
    await db
      .update(sessions)
      .set({ id: hashToken(token) })
      .where(eq(sessions.id, token));
  } catch (err) {
    console.error("[session] couldn't hash a stored token:", err);
  }
};

export const findValid = async (token: string) => {
  const id = hashToken(token);
  const cached = cache.get(id);
  if (cached && isFresh(cached)) return cached.session;
  cache.delete(id);

  const deletesBefore = deletes;
  const found = await db.query.sessions.findFirst({
    where: { id: { in: storedIds(token) }, expiresAt: { gt: now() } },
  });
  if (!found) return undefined;
  if (found.id === token) await hashStored(token);
  const session = { ...found, id };
  if (deletes === deletesBefore) remember(id, session);
  return session;
};

// Forgotten even if the delete fails: one that fails in transit may still have been applied
export const remove = async (token: string) => {
  const id = hashToken(token);
  try {
    await db.delete(sessions).where(inArray(sessions.id, storedIds(token)));
  } finally {
    forget((session) => session.id === id);
  }
};

export const hashStoredTokens = async () => {
  const stored = await db.query.sessions.findMany({
    columns: { id: true },
    where: { RAW: (session) => sql`length(${session.id}) = 64` },
  });
  const tokens = stored.map((session) => session.id).filter((id) => RAW_TOKEN.test(id));
  for (let start = 0; start < tokens.length; start += HASHED_PER_STATEMENT)
    await hashTokens(tokens.slice(start, start + HASHED_PER_STATEMENT));
  return tokens.length;
};

// Each token binds three variables, and SQLite refuses a statement with more than 32,766
const HASHED_PER_STATEMENT = 500;

const hashTokens = async (tokens: string[]) => {
  const hashed = sql.join(
    tokens.map((token) => sql`WHEN ${token} THEN ${hashToken(token)}`),
    sql` `,
  );
  await db
    .update(sessions)
    .set({ id: sql`CASE ${sessions.id} ${hashed} END` })
    .where(inArray(sessions.id, tokens));
};

/** For sessions deleted by another process, as reset-password.ts does. */
export const forgetUser = (userId: string) => forget((session) => session.userId === userId);
