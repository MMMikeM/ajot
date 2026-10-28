import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { db } from "./client";
import contactRepo from "./contact.repo";
import { NotFoundError } from "./errors";
import inviteTokenRepo from "./invite-token.repo";
import { contacts, inviteTokens, removedContacts, users } from "./schema";

// vi.mock runs before this file's imports, so the database it builds can only be imported there
vi.mock("./client", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { migrate } = await import("./migrator");
  const { relations } = await import("./schema");
  const memory = drizzle({ client: new DatabaseSync(":memory:"), relations });
  await migrate(memory, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  return { db: memory, inTransaction: (run: (tx: typeof memory) => unknown) => run(memory) };
});

const people = ["alice", "bob", "carol"];
const contactRow = (userId: string, contactUserId: string) => ({
  id: `${userId}-${contactUserId}`,
  userId,
  contactUserId,
  createdAt: "then",
});
const removal = (userId: string, otherId: string) => ({
  id: `${userId}-${otherId}`,
  userId,
  contacts: [contactRow(userId, otherId), contactRow(otherId, userId)],
  collaborators: [],
});
const recordIds = async () =>
  (await db.query.removedContacts.findMany({ columns: { id: true } })).map((r) => r.id).sort();

beforeEach(async () => {
  await db.delete(removedContacts);
  await db.delete(contacts);
  await db.delete(inviteTokens);
  await db.delete(users);
  await db
    .insert(users)
    .values(people.map((id) => ({ id, name: id, username: id, passwordHash: "x" })));
});

describe("accepting an invite from someone removed as a contact", () => {
  const acceptAlicesInvite = async (userId: string) => {
    const invite = await inviteTokenRepo.create("alice", "9999-01-01T00:00:00.000Z");
    return inviteTokenRepo.consume(invite, userId);
  };

  test("drops the Undo of either one removing the other, and no one else's", async () => {
    await db
      .insert(removedContacts)
      .values([removal("alice", "bob"), removal("bob", "alice"), removal("alice", "carol")]);

    const added = await acceptAlicesInvite("bob");

    expect(added).toHaveLength(2);
    expect(await recordIds()).toEqual(["alice-carol"]);
  });

  test("leaves a late Undo of the removal nothing to put back", async () => {
    await db.insert(removedContacts).values(removal("alice", "bob"));
    await acceptAlicesInvite("bob");

    await expect(contactRepo.restore("alice-bob", "alice")).rejects.toThrow(NotFoundError);
    const alices = await db.query.contacts.findMany({ where: { userId: "alice" } });
    expect(alices).toHaveLength(1);
  });
});
