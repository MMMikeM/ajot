import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import { db } from "./client";
import * as categoryRepo from "./category.repo";
import * as categoryCollaboratorRepo from "./category-collaborator.repo";
import * as contactRepo from "./contact.repo";
import {
  categories,
  contacts,
  removedCollaborators,
  removedContacts,
  tasks,
  taskShares,
  users,
} from "./schema";

// vi.mock runs before this file's imports, so the database it builds can only be imported there
vi.mock("./client", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { migrate } = await import("./migrator");
  const { relations } = await import("./schema");
  const memory = drizzle({ client: new DatabaseSync(":memory:"), relations });
  await migrate(memory, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  // One after another, as BEGIN IMMEDIATE runs them
  let last: Promise<unknown> = Promise.resolve();
  const inTransaction = (run: (tx: typeof memory) => unknown) => {
    const result = last.then(() => run(memory));
    last = result.catch(() => {});
    return result;
  };
  return { db: memory, inTransaction };
});

const owner = "owner";
const collaborator = "collaborator";
const stranger = "stranger";

const LIST_DELETED_AT = "2026-10-26T10:00:00.000Z";
const DELETED_SINCE = "2026-10-27T10:00:00.000Z";
const LONG_AGO = "2026-01-01T09:00:00.000Z";

const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((row) => row.id).sort();
const contactIds = () => ids(db.query.contacts.findMany({ columns: { id: true } }));
const collaboratorIds = () =>
  ids(db.query.categoryCollaborators.findMany({ columns: { id: true } }));
const removedContactIds = () => ids(db.query.removedContacts.findMany({ columns: { id: true } }));

beforeEach(async () => {
  // Every other table cascades from users
  await db.delete(users);
  await db
    .insert(users)
    .values(
      [owner, collaborator, stranger, "carol", "bob"].map((id) => ({
        id,
        name: id,
        username: id,
        passwordHash: "x",
      })),
    );
});

// Only its owner may restore a list: requireList checks that in the route, before this runs
describe("restoring a deleted list", () => {
  test("brings the list back", async () => {
    await db.insert(categories).values({
      id: "list",
      userId: owner,
      name: "Groceries",
      deletedAt: LIST_DELETED_AT,
      deletion: { deletedTaskIds: ["t1", "t2"], movedTaskIds: [], unfiledShares: [] },
    });
    await db.insert(tasks).values([
      { id: "t1", userId: owner, categoryId: "list", title: "Milk", deletedAt: LIST_DELETED_AT },
      // Deleted again on its own since the list's delete took it
      { id: "t2", userId: owner, categoryId: "list", title: "Eggs", deletedAt: DELETED_SINCE },
    ]);

    await categoryRepo.restore("list");

    expect(await db.query.categories.findFirst({ where: { id: "list" } })).toMatchObject({
      deletedAt: null,
      deletion: null,
    });
    expect(await db.query.tasks.findFirst({ where: { id: "t1" } })).toMatchObject({
      deletedAt: null,
    });
    expect(await db.query.tasks.findFirst({ where: { id: "t2" } })).toMatchObject({
      deletedAt: DELETED_SINCE,
    });
  });

  test("of a list that isn't deleted changes nothing, so a replay is harmless", async () => {
    await db
      .insert(categories)
      .values({ id: "list", userId: owner, name: "Groceries", updatedAt: LONG_AGO });
    await db
      .insert(tasks)
      .values({ id: "t1", userId: owner, categoryId: "list", title: "Milk", updatedAt: LONG_AGO });
    const listBefore = await db.query.categories.findFirst({ where: { id: "list" } });
    const tasksBefore = await db.query.tasks.findMany();

    await categoryRepo.restore("list");

    expect(await db.query.categories.findFirst({ where: { id: "list" } })).toEqual(listBefore);
    expect(await db.query.tasks.findMany()).toEqual(tasksBefore);
  });
});

describe("restoring a removed contact", () => {
  const record = {
    id: "mine",
    userId: owner,
    contacts: [
      { id: "mine", userId: owner, contactUserId: collaborator, createdAt: "then" },
      { id: "theirs", userId: collaborator, contactUserId: owner, createdAt: "then" },
    ],
    collaborators: [
      { id: "c1", categoryId: "live", userId: collaborator, addedAt: "then" },
      { id: "c2", categoryId: "gone", userId: collaborator, addedAt: "then" },
    ],
    removedAt: hoursFromNow(-0.1),
  };

  beforeEach(async () => {
    await db.insert(categories).values([
      { id: "live", userId: owner, name: "Live" },
      { id: "gone", userId: owner, name: "Gone", deletedAt: LIST_DELETED_AT },
    ]);
  });

  test("is only for the person who removed it", async () => {
    await db.insert(removedContacts).values(record);
    for (const userId of [collaborator, stranger]) {
      await expect(contactRepo.restore("mine", userId)).rejects.toMatchObject({ status: 404 });
    }
    expect(await removedContactIds()).toEqual(["mine"]);
    expect(await contactIds()).toEqual([]);
    expect(await collaboratorIds()).toEqual([]);
  });

  test("puts both rows back, and sharing for the lists that still exist", async () => {
    await db.insert(removedContacts).values(record);
    await contactRepo.restore("mine", owner);
    expect(await contactIds()).toEqual(["mine", "theirs"]);
    expect(await collaboratorIds()).toEqual(["c1"]);
    expect(await removedContactIds()).toEqual([]);
  });

  test("puts back what leaving the list took out of it", async () => {
    await db.insert(tasks).values([
      { id: "their-task", userId: collaborator, title: "Theirs" },
      { id: "shared-with-them", userId: owner, title: "Shared" },
    ]);
    await db
      .insert(taskShares)
      .values({ id: "share", taskId: "shared-with-them", sharedWithUserId: collaborator });
    const left = { movedTaskIds: ["their-task"], unfiledTaskIds: ["shared-with-them"] };
    await db
      .insert(removedContacts)
      .values({ ...record, collaborators: [{ ...record.collaborators[0]!, left }] });

    await contactRepo.restore("mine", owner);

    expect(await db.query.tasks.findFirst({ where: { id: "their-task" } })).toMatchObject({
      categoryId: "live",
    });
    expect(await db.query.taskShares.findFirst({ where: { id: "share" } })).toMatchObject({
      categoryId: "live",
    });
    expect(await collaboratorIds()).toEqual(["c1"]);
  });

  test("more than an hour later is not found", async () => {
    await db.insert(removedContacts).values({ ...record, removedAt: hoursFromNow(-1.1) });
    await expect(contactRepo.restore("mine", owner)).rejects.toMatchObject({ status: 404 });
    expect(await contactIds()).toEqual([]);
    expect(await removedContactIds()).toEqual(["mine"]);
  });

  test("replayed after it landed changes nothing, so a lost response doesn't undo the Undo", async () => {
    await db.insert(removedContacts).values(record);
    await contactRepo.restore("mine", owner);
    await expect(contactRepo.restore("mine", owner)).resolves.toMatchObject({
      contact: record.contacts[0],
      restored: [],
    });
    expect(await contactIds()).toEqual(["mine", "theirs"]);
  });

  test("replayed by someone else is still not found", async () => {
    await db.insert(contacts).values(record.contacts[1]!);
    await expect(contactRepo.restore("theirs", owner)).rejects.toMatchObject({ status: 404 });
  });
});

describe("removing a contact", () => {
  test("drops Undo records past their hour before keeping its own", async () => {
    await db.insert(contacts).values([
      { id: "mine", userId: owner, contactUserId: collaborator },
      { id: "theirs", userId: collaborator, contactUserId: owner },
    ]);
    const nothingKept = { contacts: [], collaborators: [] };
    await db.insert(removedContacts).values([
      { id: "stale", userId: stranger, ...nothingKept, removedAt: hoursFromNow(-2) },
      { id: "carols", userId: "carol", ...nothingKept, removedAt: hoursFromNow(-0.1) },
    ]);

    await contactRepo.remove("mine", owner);

    expect(await removedContactIds()).toEqual(["carols", "mine"]);
  });

  test("unshares the tasks between them both ways, which Undo shares again as filed", async () => {
    await db.insert(contacts).values([
      { id: "mine", userId: owner, contactUserId: collaborator },
      { id: "theirs", userId: collaborator, contactUserId: owner },
    ]);
    await db.insert(categories).values({ id: "their-list", userId: collaborator, name: "Theirs" });
    await db.insert(tasks).values([
      { id: "owners-task", userId: owner, title: "Owner's" },
      { id: "their-task", userId: collaborator, title: "Theirs" },
      { id: "carols-task", userId: "carol", title: "Carol's" },
    ]);
    await db.insert(taskShares).values([
      {
        id: "to-them",
        taskId: "owners-task",
        sharedWithUserId: collaborator,
        categoryId: "their-list",
      },
      { id: "to-owner", taskId: "their-task", sharedWithUserId: owner, permission: "view" },
      { id: "carols", taskId: "carols-task", sharedWithUserId: collaborator },
    ]);
    const shares = () =>
      db.query.taskShares.findMany({
        columns: { id: true, categoryId: true, permission: true },
        orderBy: { id: "asc" },
      });
    const before = await shares();

    const removal = await contactRepo.remove("mine", owner);

    expect(await shares()).toEqual([{ id: "carols", categoryId: null, permission: "edit" }]);
    expect(await ids(db.query.tasks.findMany({ columns: { id: true } }))).toEqual([
      "carols-task",
      "owners-task",
      "their-task",
    ]);
    expect(removal.changed).toEqual(expect.arrayContaining(["owners-task", "their-task"]));

    const undo = await contactRepo.restore("mine", owner);

    expect(await shares()).toEqual(before);
    expect(undo.changed).toEqual(expect.arrayContaining(["owners-task", "their-task"]));
  });

  test("twice at once keeps the first's Undo", async () => {
    await db.insert(contacts).values([
      { id: "mine", userId: owner, contactUserId: collaborator },
      { id: "theirs", userId: collaborator, contactUserId: owner },
    ]);

    const [first, second] = await Promise.allSettled([
      contactRepo.remove("mine", owner),
      contactRepo.remove("mine", owner),
    ]);

    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: { status: 404 } });
    await contactRepo.restore("mine", owner);
    expect(await contactIds()).toEqual(["mine", "theirs"]);
  });
});

// Only the list's owner may restore someone they removed: requireList checks that in the route
describe("restoring someone removed from a list", () => {
  test("more than an hour later is not found", async () => {
    await db.insert(categories).values({ id: "list", userId: owner, name: "Groceries" });
    await db.insert(removedCollaborators).values({
      id: "c1",
      categoryId: "list",
      userId: collaborator,
      addedAt: "then",
      movedTaskIds: [],
      unfiledTaskIds: [],
      removedAt: hoursFromNow(-1.1),
    });

    await expect(categoryCollaboratorRepo.restore("list", collaborator)).rejects.toMatchObject({
      status: 404,
    });
    expect(await collaboratorIds()).toEqual([]);
    expect(
      await ids(db.query.removedCollaborators.findMany({ columns: { id: true } })),
    ).toEqual(["c1"]);
  });
});
