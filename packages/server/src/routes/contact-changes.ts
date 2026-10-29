import type { Context } from "hono";
import * as contactRepo from "../db/contact.repo";
import { broadcastPerUser, type BroadcastEvent } from "../broadcast";

type ContactRow = { id: string; userId: string };

/** Each person lists only their own contact rows, so a row's change goes only to its owner. */
export const addressContactChanges = (
  removed: ContactRow[],
  added: contactRepo.ContactWithUser[],
) => [
  ...removed.map((row) => ({
    userId: row.userId,
    event: { model: "contacts", action: "delete", data: { id: row.id } } satisfies BroadcastEvent,
  })),
  ...added.map((row) => ({
    userId: row.userId,
    event: { model: "contacts", action: "insert", data: row } satisfies BroadcastEvent,
  })),
];

/** After a write that removed or added contact rows, so both people's pages show it live. */
export const sendContactChanges = async (
  c: Context,
  { removed = [], addedIds = [] }: { removed?: ContactRow[]; addedIds?: string[] },
) => {
  try {
    const added = await contactRepo.listByIds(addedIds);
    broadcastPerUser(c, addressContactChanges(removed, added));
  } catch (err) {
    // The write has succeeded, and failing its request would only have it sent again
    console.error("[contacts] couldn't send the change", err);
  }
};
