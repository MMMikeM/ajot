import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { now } from "@newtab-todo/shared/iso";
import { db, inTransaction } from "./client";
import { contacts, inviteTokens, removedContacts } from "./schema";
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

/** The display name of whoever made a still-usable invite, or null. */
const findInviterName = async (token: string) => {
  const invite = await db.query.inviteTokens.findFirst({
    columns: {},
    where: { id: token, usedAt: { isNull: true }, expiresAt: { gt: now() } },
    with: { createdByUser: { columns: { name: true } } },
  });
  return invite?.createdByUser?.name ?? null;
};

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

const removedBy = (userId: string, otherId: string) =>
  and(
    eq(removedContacts.userId, userId),
    sql`exists (select 1 from json_each(${removedContacts.contacts})
      where json_extract(value, '$.contactUserId') = ${otherId})`,
  );

// One transaction, so a failed contact insert leaves the token unused for a retry. The caller
// passes an invite already validated by findValid; this doesn't check it again. Returns the
// contact rows it added, none if the two were contacts already. Being contacts again drops the
// Undo of either one's removal of the other, which would put back lists they shared then.
const consume = async (invite: InviteToken, usedByUserId: string) =>
  inTransaction(async (tx) => {
    const inviterId = invite.createdByUserId;
    await tx
      .update(inviteTokens)
      .set({ usedAt: now(), usedByUserId })
      .where(eq(inviteTokens.id, invite.id));
    await tx
      .delete(removedContacts)
      .where(or(removedBy(inviterId, usedByUserId), removedBy(usedByUserId, inviterId)));

    return tx
      .insert(contacts)
      .values([
        { id: createId(), userId: inviterId, contactUserId: usedByUserId },
        { id: createId(), userId: usedByUserId, contactUserId: inviterId },
      ])
      .onConflictDoNothing()
      .returning();
  });

export default { create, findById, findValid, findInviterName, claim, release, consume };
