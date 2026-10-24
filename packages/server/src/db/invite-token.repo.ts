import { and, eq, gt, isNull } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { now } from "@newtab-todo/shared/iso";
import { db, inTransaction } from "./client";
import { contacts, inviteTokens } from "./schema";
import { InsertFailedError } from "./errors";

const create = async (createdByUserId: string, expiresAt: string) => {
  const id = createId();
  const [row] = await db
    .insert(inviteTokens)
    .values({ id, createdByUserId, expiresAt })
    .returning();
  if (!row) throw new InsertFailedError("invite token");
  return row;
};

const findById = async (token: string) => db.query.inviteTokens.findFirst({ where: { id: token } });

const findValid = async (token: string) =>
  db.query.inviteTokens.findFirst({
    where: {
      id: token,
      usedAt: { isNull: true },
      expiresAt: { gt: now() },
    },
  });

type InviteToken = NonNullable<Awaited<ReturnType<typeof findValid>>>;

// Marks the invite used in one statement, so two signups racing on the same link can't both
// pass. consume() records who used it once their account exists.
const claim = async (token: string) => {
  const [row] = await db
    .update(inviteTokens)
    .set({ usedAt: now() })
    .where(
      and(
        eq(inviteTokens.id, token),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now()),
      ),
    )
    .returning();
  return row;
};

/** Undoes claim() when the account it was for couldn't be created. */
const release = async (token: string) => {
  await db.update(inviteTokens).set({ usedAt: null }).where(eq(inviteTokens.id, token));
};

// One transaction, so a failed contact insert leaves the token unused for a retry. The caller
// passes an invite already validated by findValid; this doesn't check it again.
const consume = async (invite: InviteToken, usedByUserId: string) => {
  await inTransaction(async (tx) => {
    await tx
      .update(inviteTokens)
      .set({ usedAt: now(), usedByUserId })
      .where(eq(inviteTokens.id, invite.id));

    await tx
      .insert(contacts)
      .values([
        { id: createId(), userId: invite.createdByUserId, contactUserId: usedByUserId },
        { id: createId(), userId: usedByUserId, contactUserId: invite.createdByUserId },
      ])
      .onConflictDoNothing();
  });
};

export default { create, findById, findValid, claim, release, consume };
