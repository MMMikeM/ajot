import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { now } from "@newtab-todo/shared/iso";
import { db, inTransaction } from "./client";
import { contacts, inviteTokens, removedContacts } from "./schema";
import { InsertFailedError, NotFoundError } from "./errors";

const create = async (createdByUserId: string, expiresAt: string) => {
  const id = createId();
  const [row] = await db
    .insert(inviteTokens)
    .values({ id, createdByUserId, expiresAt })
    .returning();
  if (!row) throw new InsertFailedError("invite token");
  return row;
};

/**
 * The display name of whoever made a still-usable invite. An unknown, used or expired one is the
 * same NotFoundError, without the token, which is the link's secret.
 */
const findInviterName = async (token: string) => {
  const invite = await db.query.inviteTokens.findFirst({
    columns: {},
    where: { id: token, usedAt: { isNull: true }, expiresAt: { gt: now() } },
    with: { createdByUser: { columns: { name: true } } },
  });
  if (!invite?.createdByUser) throw new NotFoundError("invite");
  return invite.createdByUser.name;
};

// Marks the invite used in one statement, so two signups or accepts racing on the same link can't
// both pass. consume() records who used it once their account exists.
const claim = async (token: string) => {
  const rows = await db
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
  return rows.at(0);
};

type InviteToken = NonNullable<Awaited<ReturnType<typeof claim>>>;

/** Undoes claim() when what it was claimed for, an account or a contact, didn't happen. */
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
// passes an invite it claimed; this doesn't check it again. Returns the
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

export default { create, findInviterName, claim, release, consume };
