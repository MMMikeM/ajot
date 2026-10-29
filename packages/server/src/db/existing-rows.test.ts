import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { isSortKey } from "@newtab-todo/shared/sort-order";
import { migrate } from "./migrator";

// What the migrations after removed_collaborators do to rows already in the database: the
// migrations up to it are applied, rows they allowed are seeded, then the rest are applied
const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const before = mkdtempSync(join(tmpdir(), "ajot-migrations-"));
const BASE = "20261027193136_removed_collaborators";
for (const name of readdirSync(migrations).filter((name) => name <= BASE))
  cpSync(join(migrations, name), join(before, name), { recursive: true });
afterAll(() => rmSync(before, { recursive: true }));

type Row = Record<string, unknown>;

const seeded = async (seed: (sqlite: DatabaseSync) => void) => {
  const sqlite = new DatabaseSync(":memory:");
  const db = drizzle({ client: sqlite });
  await migrate(db, before);
  sqlite.exec(`INSERT INTO users (id, name, username, password_hash)
    VALUES ('alice', 'Alice', 'alice', 'x'), ('bob', 'Bob', 'bob', 'x')`);
  seed(sqlite);
  const read = () => ({
    tasks: sqlite.prepare("SELECT * FROM tasks ORDER BY sort_order, created_at, id").all() as Row[],
    categories: sqlite
      .prepare("SELECT * FROM categories ORDER BY sort_order, name, id")
      .all() as Row[],
  });
  const was = read();
  await migrate(db, migrations);
  return { was, now: read(), sqlite };
};

const task = (id: string, sortOrder: string | null, more = "") =>
  `('${id}', 'alice', '${id}', ${sortOrder === null ? "NULL" : `'${sortOrder}'`},
    '2026-01-01T00:00:0${id.length % 10}.000Z', '2026-02-01T00:00:00.000Z'${more})`;
const ids = (rows: Row[]) => rows.map((row) => row.id);
const keys = (rows: Row[]) => rows.map((row) => row.sort_order);
// The migrations add live, top_level, has_parent and sent_by_id, so rows from before lack them;
// only the database reads the first three
const without = (rows: Row[], column: string) =>
  rows
    .map(
      ({
        [column]: _dropped,
        live: _live,
        top_level: _topLevel,
        has_parent: _hasParent,
        sent_by_id: _sentBy,
        ...rest
      }) => rest,
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe("tables holding keys the CHECK refuses", async () => {
  const { was, now } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO categories (id, user_id, name, sort_order) VALUES
      ('home', 'alice', 'Home', 'a0'), ('work', 'alice', 'Work', 'a00'),
      ('errands', 'bob', 'Errands', 'a0'), ('later', 'bob', 'Later', NULL),
      ('odd', 'bob', 'Odd', 'a0!')`);
    sqlite.exec(`INSERT INTO tasks (id, user_id, title, sort_order, created_at, updated_at) VALUES
      ${task("a", "a0")}, ${task("b", "a00")}, ${task("c", "a1")}, ${task("d", "a10")},
      ${task("e", "a1")}, ${task("f", null)}, ${task("g", "Zz")}, ${task("h", "")},
      ${task("i", "b0")}`);
    sqlite.exec(`UPDATE tasks SET category_id = 'home' WHERE id IN ('a', 'b', 'c');
      UPDATE tasks SET category_id = 'work' WHERE id IN ('d', 'e')`);
  });

  test("keeps every row", () => {
    expect(now.tasks).toHaveLength(was.tasks.length);
    expect(now.categories).toHaveLength(was.categories.length);
  });

  test("keeps the order, ties broken as the server breaks them, across the whole table", () => {
    expect(ids(now.tasks)).toEqual(ids(was.tasks));
    expect(ids(now.categories)).toEqual(ids(was.categories));
  });

  test("gives each row with a key one of its own that the CHECK takes, and none to the rest", () => {
    for (const rows of [now.tasks, now.categories]) {
      const given = keys(rows).filter((key) => key !== null);
      expect(given.filter((key) => !isSortKey(key as string))).toEqual([]);
      expect(new Set(given).size).toBe(given.length);
    }
    expect(now.tasks.find((row) => row.id === "f")?.sort_order).toBeNull();
    expect(now.categories.find((row) => row.id === "later")?.sort_order).toBeNull();
  });

  test("changes nothing else, updatedAt included", () => {
    expect(without(now.tasks, "sort_order")).toEqual(without(was.tasks, "sort_order"));
    expect(without(now.categories, "sort_order")).toEqual(without(was.categories, "sort_order"));
  });
});

describe("tables whose keys the CHECK takes", async () => {
  const { was, now } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO categories (id, user_id, name, sort_order) VALUES
      ('home', 'alice', 'Home', 'a0'), ('work', 'alice', 'Work', 'a0')`);
    sqlite.exec(`INSERT INTO tasks (id, user_id, title, sort_order, created_at, updated_at) VALUES
      ${task("a", "a0")}, ${task("b", "a0V")}, ${task("c", null)}, ${task("d", "a0")}`);
  });

  test("keep their keys, duplicates included", () => {
    expect(ids(now.tasks)).toEqual(ids(was.tasks));
    expect(keys(now.tasks)).toEqual(keys(was.tasks));
    expect(now.categories).toEqual(was.categories);
  });
});

describe("a live subtask under a deleted parent", async () => {
  const { now } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO tasks (id, user_id, title, sort_order, created_at, updated_at, parent_id, deleted_at) VALUES
      ${task("parent", "a0", ", NULL, '2026-03-01T00:00:00.000Z'")},
      ${task("orphan", null, ", 'parent', NULL")},
      ${task("alive", "a1", ", NULL, NULL")},
      ${task("sub", null, ", 'alive', NULL")}`);
  });
  const deletedAt = (id: string) => now.tasks.find((row) => row.id === id)?.deleted_at;

  test("is hidden with its parent's deletedAt, and a live parent's subtask is left alone", () => {
    expect(deletedAt("orphan")).toBe("2026-03-01T00:00:00.000Z");
    expect(deletedAt("sub")).toBeNull();
  });
});

describe("push subscriptions with no user, which got everyone's pushes", async () => {
  const { sqlite } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES
      ('alices', 'alice', 'https://push.example/alice', 'key', 'secret'),
      ('orphan', NULL, 'https://push.example/orphan', 'key', 'secret')`);
  });

  test("are deleted, and the rest kept", () => {
    const rows = sqlite.prepare("SELECT id FROM push_subscriptions").all();
    expect(rows).toEqual([{ id: "alices" }]);
  });
});

describe("rows stamped ahead of the server's clock, which no edit could beat", async () => {
  const { was, now, sqlite } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO categories (id, user_id, name, updated_at) VALUES
      ('ahead', 'alice', 'Ahead', '9999-01-01T00:00:00.000Z'),
      ('kept', 'alice', 'Kept', '2026-02-01T00:00:00.000Z')`);
    sqlite.exec(`INSERT INTO tasks (id, user_id, title, sort_order, created_at, updated_at) VALUES
      ${task("ahead", null)}, ${task("kept", null)}`);
    sqlite.exec(`UPDATE tasks SET updated_at = '9999-01-01T00:00:00.000Z',
      edited_at = '9999-01-01T00:00:00.000Z' WHERE id = 'ahead'`);
    sqlite.exec(`INSERT INTO notes (id, user_id, task_id, title, updated_at)
      VALUES ('ahead', 'alice', 'kept', 'n', '9999-01-01T00:00:00.000Z')`);
  });
  const migratedAt = new Date().toISOString();
  const row = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

  test("are stamped no later than when the migration ran", () => {
    expect(row(now.tasks, "ahead").updated_at! <= migratedAt).toBe(true);
    expect(row(now.tasks, "ahead").edited_at! <= migratedAt).toBe(true);
    expect(row(now.categories, "ahead").updated_at! <= migratedAt).toBe(true);
    const note = sqlite.prepare("SELECT updated_at FROM notes WHERE id = 'ahead'").get();
    expect(String(note?.updated_at) <= migratedAt).toBe(true);
  });

  test("and the rest keep theirs", () => {
    expect(without([row(now.tasks, "kept")], "live")).toEqual(
      without([row(was.tasks, "kept")], "live"),
    );
    expect(row(now.categories, "kept")).toEqual(row(was.categories, "kept"));
  });
});

describe("a task shared with the same person more than once", async () => {
  const { sqlite } = await seeded((sqlite) => {
    sqlite.exec(`INSERT INTO users (id, name, username, password_hash)
      VALUES ('carol', 'Carol', 'carol', 'x')`);
    sqlite.exec(`INSERT INTO tasks (id, user_id, title, sort_order, created_at, updated_at) VALUES
      ${task("a", "a0")}, ${task("b", "a1")}`);
    sqlite.exec(`INSERT INTO task_shares (id, task_id, shared_with_user_id) VALUES
      ('first', 'a', 'bob'), ('again', 'a', 'bob'), ('carols', 'a', 'carol'),
      ('other', 'b', 'bob'), ('third', 'a', 'bob')`);
  });
  const shares = sqlite.prepare("SELECT id FROM task_shares ORDER BY id").all() as Row[];

  test("keeps the first share each person had, and every other share", () => {
    expect(ids(shares)).toEqual(["carols", "first", "other"]);
  });

  test("can't be shared with them again", () => {
    expect(() =>
      sqlite.exec(`INSERT INTO task_shares (id, task_id, shared_with_user_id)
        VALUES ('more', 'a', 'bob')`),
    ).toThrow(/UNIQUE/);
  });
});
