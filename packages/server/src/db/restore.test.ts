import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import * as categoryRepo from "./category.repo";
import * as categoryCollaboratorRepo from "./category-collaborator.repo";
import * as contactRepo from "./contact.repo";
import {
  categories,
  categoryCollaborators,
  contacts,
  removedCollaborators,
  removedContacts,
  tasks,
  taskShares,
} from "./schema";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

// vi.mock is hoisted above the imports, so the fake it returns has to be too
const { tables, writes, fakeDb } = vi.hoisted(() => {
  const tables: Record<string, Row[]> = {};
  const writes: { op: string; table: unknown; data?: unknown }[] = [];

  // Enough of the relational filter syntax for the reads these restores make
  const matches = (row: Row, where: Where = {}) =>
    Object.entries(where).every(([key, want]) => {
      if (want && typeof want === "object" && "in" in want)
        return (want.in as unknown[]).includes(row[key]);
      if (want && typeof want === "object" && "isNull" in want)
        return (row[key] == null) === want.isNull;
      if (want && typeof want === "object" && "gte" in want)
        return (row[key] as string) >= (want.gte as string);
      return row[key] === want;
    });

  const reader = (name: string) => ({
    findFirst: async ({ where }: { where?: Where }) => tables[name]?.find((r) => matches(r, where)),
    findMany: async ({ where }: { where?: Where }) =>
      (tables[name] ?? []).filter((r) => matches(r, where)),
  });

  const writer = (op: string, table: unknown) => {
    const entry: (typeof writes)[number] = { op, table };
    writes.push(entry);
    const steps: Record<string, (data: Row) => unknown> = {
      values: (data) => ((entry.data = data), builder),
      // Updates every row of the table, ignoring where: each test holds one row per table
      set: (data) => {
        entry.data = data;
        const name = (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
        const key = name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
        for (const row of tables[key] ?? []) Object.assign(row, data);
        return builder;
      },
    };
    for (const step of ["where", "returning", "onConflictDoNothing", "onConflictDoUpdate"])
      steps[step] = () => builder;
    const builder = Object.assign(Promise.resolve<Row[]>([]), steps);
    return builder;
  };

  const fakeDb = {
    query: new Proxy({}, { get: (_, name: string) => reader(name) }),
    insert: (table: unknown) => writer("insert", table),
    update: (table: unknown) => writer("update", table),
    delete: (table: unknown) => writer("delete", table),
  };
  return { tables, writes, fakeDb };
});

vi.mock("./client", () => ({
  db: fakeDb,
  inTransaction: (run: (tx: typeof fakeDb) => unknown) => run(fakeDb),
}));

// Reads the views, which the fake can't; what it reads only addresses the broadcast
vi.mock("./reach.repo", () => ({
  read: async () => ({ taskIds: [], listIds: [], tasks: new Map(), lists: new Map() }),
}));

const owner = "owner";
const collaborator = "collaborator";
const stranger = "stranger";

const list = (fields: Row = {}) => ({
  id: "list",
  userId: owner,
  name: "Groceries",
  deletedAt: "2026-10-26T10:00:00.000Z",
  deletion: { deletedTaskIds: ["t1"], movedTaskIds: [], unfiledShares: [] },
  collaborators: [{ userId: collaborator }],
  ...fields,
});

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  writes.length = 0;
});

// Only its owner may restore a list: requireList checks that in the route, before this runs
describe("restoring a deleted list", () => {
  test("of a list that doesn't exist is not found", async () => {
    await expect(categoryRepo.restore("list")).rejects.toMatchObject({ status: 404 });
    expect(writes).toEqual([]);
  });

  test("brings the list back", async () => {
    tables.categories = [list()];
    await categoryRepo.restore("list");
    expect(writes[0]).toMatchObject({
      op: "update",
      table: categories,
      data: { deletedAt: null, deletion: null },
    });
  });

  test("of a list that isn't deleted changes nothing, so a replay is harmless", async () => {
    tables.categories = [list({ deletedAt: null, deletion: null })];
    await categoryRepo.restore("list");
    expect(writes).toEqual([]);
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

  test("is only for the person who removed it", async () => {
    tables.removedContacts = [record];
    for (const userId of [collaborator, stranger]) {
      await expect(contactRepo.restore("mine", userId)).rejects.toMatchObject({ status: 404 });
    }
    expect(writes).toEqual([]);
  });

  test("puts both rows back, and sharing for the lists that still exist", async () => {
    tables.removedContacts = [record];
    tables.categories = [{ id: "live", deletedAt: null }];
    await contactRepo.restore("mine", owner);
    expect(writes).toEqual([
      { op: "insert", table: contacts, data: record.contacts },
      { op: "insert", table: categoryCollaborators, data: [record.collaborators[0]] },
      { op: "delete", table: removedContacts },
    ]);
  });

  test("puts back what leaving the list took out of it", async () => {
    const left = { movedTaskIds: ["bobs-task"], unfiledTaskIds: ["shared-with-bob"] };
    tables.removedContacts = [{ ...record, collaborators: [{ ...record.collaborators[0], left }] }];
    tables.categories = [{ id: "live", deletedAt: null }];
    await contactRepo.restore("mine", owner);
    expect(writes.map(({ op, table }) => ({ op, table }))).toEqual([
      { op: "insert", table: contacts },
      { op: "insert", table: categoryCollaborators },
      { op: "update", table: tasks },
      { op: "update", table: taskShares },
      { op: "delete", table: removedContacts },
    ]);
    expect(writes[1]!.data).toEqual([record.collaborators[0]]);
  });

  test("with nothing left to restore is not found", async () => {
    await expect(contactRepo.restore("mine", owner)).rejects.toMatchObject({ status: 404 });
  });

  test("more than an hour later is not found", async () => {
    tables.removedContacts = [{ ...record, removedAt: hoursFromNow(-1.1) }];
    await expect(contactRepo.restore("mine", owner)).rejects.toMatchObject({ status: 404 });
    expect(writes).toEqual([]);
  });

  test("replayed after it landed changes nothing, so a lost response doesn't undo the Undo", async () => {
    tables.contacts = [record.contacts[0]];
    await expect(contactRepo.restore("mine", owner)).resolves.toMatchObject({
      contact: record.contacts[0],
      restored: [],
    });
    expect(writes).toEqual([]);
  });

  test("replayed by someone else is still not found", async () => {
    tables.contacts = [record.contacts[1]];
    await expect(contactRepo.restore("theirs", owner)).rejects.toMatchObject({ status: 404 });
  });
});

describe("removing a contact", () => {
  test("drops Undo records past their hour before keeping its own", async () => {
    tables.contacts = [{ id: "mine", userId: owner, contactUserId: collaborator }];
    await contactRepo.remove("mine", owner);
    expect(writes.map(({ op, table }) => ({ op, table }))).toEqual([
      { op: "delete", table: contacts },
      { op: "delete", table: removedContacts },
      { op: "insert", table: removedContacts },
    ]);
  });
});

// Only the list's owner may restore someone they removed: requireList checks that in the route
describe("restoring someone removed from a list", () => {
  const record = {
    id: "c1",
    categoryId: "list",
    userId: collaborator,
    addedAt: "then",
    movedTaskIds: ["their-task"],
    unfiledTaskIds: ["shared-with-them"],
    removedAt: hoursFromNow(-0.1),
  };

  test("with nothing recorded is not found", async () => {
    await expect(categoryCollaboratorRepo.restore("list", collaborator)).rejects.toMatchObject({
      status: 404,
    });
    expect(writes).toEqual([]);
  });

  test("more than an hour later is not found", async () => {
    tables.removedCollaborators = [{ ...record, removedAt: hoursFromNow(-1.1) }];
    await expect(categoryCollaboratorRepo.restore("list", collaborator)).rejects.toMatchObject({
      status: 404,
    });
    expect(writes).toEqual([]);
  });

  test("puts back their row, what leaving took out of the list, then drops the record", async () => {
    tables.removedCollaborators = [record];
    await categoryCollaboratorRepo.restore("list", collaborator);
    expect(writes.map(({ op, table }) => ({ op, table }))).toEqual([
      { op: "insert", table: categoryCollaborators },
      { op: "update", table: tasks },
      { op: "update", table: taskShares },
      { op: "delete", table: removedCollaborators },
    ]);
    expect(writes[0]!.data).toEqual({
      id: "c1",
      categoryId: "list",
      userId: collaborator,
      addedAt: "then",
    });
  });

  test("of someone else's removal is not found", async () => {
    tables.removedCollaborators = [record];
    await expect(categoryCollaboratorRepo.restore("list", stranger)).rejects.toMatchObject({
      status: 404,
    });
    expect(writes).toEqual([]);
  });
});
