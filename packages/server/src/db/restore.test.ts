import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import categoryRepo from "./category.repo";
import contactRepo from "./contact.repo";
import { categories, categoryCollaborators, contacts, removedContacts } from "./schema";

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
    // Awaiting any step resolves to no rows
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

describe("restoring a deleted list", () => {
  test("is refused to anyone but its owner, before anything is written", async () => {
    tables.categories = [list()];
    for (const userId of [collaborator, stranger]) {
      await expect(categoryRepo.restore("list", userId)).rejects.toMatchObject({ status: 403 });
    }
    expect(writes).toEqual([]);
  });

  test("of a list that doesn't exist is not found", async () => {
    await expect(categoryRepo.restore("list", owner)).rejects.toMatchObject({ status: 404 });
    expect(writes).toEqual([]);
  });

  test("brings the list back for its owner", async () => {
    tables.categories = [list()];
    // The read after the transaction stands in for the restored list
    const restored = await categoryRepo.restore("list", owner);
    expect(writes[0]).toMatchObject({
      op: "update",
      table: categories,
      data: { deletedAt: null, deletion: null },
    });
    expect(restored.memberIds).toEqual([owner, collaborator]);
  });

  test("of a list that isn't deleted changes nothing, so a replay is harmless", async () => {
    tables.categories = [list({ deletedAt: null, deletion: null })];
    await categoryRepo.restore("list", owner);
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

  test("with nothing left to restore is not found", async () => {
    await expect(contactRepo.restore("mine", owner)).rejects.toMatchObject({ status: 404 });
  });
});
