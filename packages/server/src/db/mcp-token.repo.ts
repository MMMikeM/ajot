import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { createSelectSchema } from "drizzle-orm/zod";
import { hoursFromNow, now } from "@newtab-todo/shared/iso";
import { db } from "./client";
import { mcpTokens, type tokenKinds } from "./schema";
import { NotFoundError } from "./errors";

type Kind = (typeof tokenKinds)[number];

// Told apart before any lookup, so a token is only ever looked for among its own kind
const PREFIX: Record<Kind, string> = { mcp: "ajot_pat_", widget: "ajot_wgt_" };
const HINT_LENGTH = 4;

export const kindOf = (token: string) =>
  (Object.keys(PREFIX) as Kind[]).find((kind) => token.startsWith(PREFIX[kind]));

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

// What Settings lists: never the hash
const listed = { tokenHash: false } as const;
export const listedSchema = createSelectSchema(mcpTokens).omit({ tokenHash: true });

const live = () => gt(mcpTokens.expiresAt, now());

// Claude's tokens: the widget's belong to the app's sign-in, and are never shown
export const listOf = async (userId: string) =>
  db.query.mcpTokens.findMany({
    where: { userId, kind: "mcp", expiresAt: { gt: now() } },
    columns: listed,
    orderBy: { createdAt: "desc" },
  });

export const countLive = (userId: string) =>
  db.$count(mcpTokens, and(eq(mcpTokens.userId, userId), eq(mcpTokens.kind, "mcp"), live()));

/** The token itself is in the reply only, never stored. */
export const create = async (
  userId: string,
  {
    name,
    canWrite,
    days,
    kind = "mcp",
    sessionId = null,
  }: { name: string; canWrite: boolean; days: number; kind?: Kind; sessionId?: string | null },
) => {
  const token = `${PREFIX[kind]}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(mcpTokens)
    .values({
      id: createId(),
      userId,
      name,
      canWrite,
      kind,
      sessionId,
      tokenHash: hashToken(token),
      hint: token.slice(-HINT_LENGTH),
      expiresAt: hoursFromNow(days * 24),
    })
    .returning();
  const { tokenHash: _tokenHash, ...shown } = row!;
  return { token, ...shown };
};

const WIDGET_DAYS = 365;

/** One per sign-in: a phone's earlier widget token goes when it's approved again. */
export const replaceWidgetToken = async (userId: string, sessionId: string) => {
  await db
    .delete(mcpTokens)
    .where(and(eq(mcpTokens.sessionId, sessionId), eq(mcpTokens.kind, "widget")));
  return create(userId, {
    name: "Android widget",
    canWrite: true,
    days: WIDGET_DAYS,
    kind: "widget",
    sessionId,
  });
};

export const remove = async (id: string, userId: string) => {
  const [row] = await db
    .delete(mcpTokens)
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId)))
    .returning({ id: mcpTokens.id });
  if (!row) throw new NotFoundError("mcp token", id);
  return row;
};

/**
 * Undefined for a token that isn't one, has expired or was revoked. Not cached: revoking happens
 * in other processes too (reset-password), and a cached token would outlive it.
 */
export const findValid = async (token: string, kind: Kind) => {
  if (!token.startsWith(PREFIX[kind])) return undefined;
  return db.query.mcpTokens.findFirst({
    where: { tokenHash: hashToken(token), kind, expiresAt: { gt: now() } },
    columns: { id: true, userId: true, canWrite: true, expiresAt: true },
  });
};

/** At most hourly, so a busy token doesn't write on every call. */
export const markUsed = async (id: string) => {
  const anHourAgo = hoursFromNow(-1);
  await db
    .update(mcpTokens)
    .set({ lastUsedAt: now() })
    .where(
      and(
        eq(mcpTokens.id, id),
        or(isNull(mcpTokens.lastUsedAt), lt(mcpTokens.lastUsedAt, anHourAgo)),
      ),
    );
};
