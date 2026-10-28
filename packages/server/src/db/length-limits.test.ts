import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { MAX_NAME, MAX_SORT_KEY, MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { migrate } from "./migrator";

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const before = mkdtempSync(join(tmpdir(), "ajot-length-limits-"));
const BASE = "20261028100506_task_sender_and_one_share_each";
for (const name of readdirSync(migrations).filter((name) => name <= BASE))
  cpSync(join(migrations, name), join(before, name), { recursive: true });
afterAll(() => rmSync(before, { recursive: true }));

type Row = Record<string, unknown>;

const database = async (folder: string) => {
  const sqlite = new DatabaseSync(":memory:");
  await migrate(drizzle({ client: sqlite }), folder);
  sqlite.exec(`INSERT INTO users (id, name, username, password_hash)
    VALUES ('alice', 'Alice', 'alice', 'x')`);
  return sqlite;
};

const insertTask = (sqlite: DatabaseSync, id: string, title: string, more: Row = {}) => {
  const row: Row = { id, user_id: "alice", title, ...more };
  const columns = Object.keys(row);
  const values = columns.map(() => "?").join(", ");
  sqlite
    .prepare(`INSERT INTO tasks (${columns.join(", ")}) VALUES (${values})`)
    .run(...(Object.values(row) as string[]));
};

describe("the length CHECKs", async () => {
  const sqlite = await database(migrations);
  insertTask(sqlite, "parent", "Parent");
  const run =
    (sql: string, ...values: string[]) =>
    () =>
      sqlite.prepare(sql).run(...values);
  const note = (title: string, content: string) =>
    run(
      `INSERT INTO notes (id, user_id, task_id, title, content)
        VALUES (?, 'alice', 'parent', ?, ?)`,
      crypto.randomUUID(),
      title,
      content,
    );

  test.each([
    ["a task's title", () => insertTask(sqlite, "long-title", "t".repeat(MAX_TITLE + 1))],
    [
      "a task's description",
      () => insertTask(sqlite, "long-text", "T", { description: "d".repeat(MAX_TEXT + 1) }),
    ],
    [
      "a sort key",
      () => insertTask(sqlite, "long-key", "T", { sort_order: `a0${"V".repeat(MAX_SORT_KEY)}` }),
    ],
    ["a note's title", note("n".repeat(MAX_TITLE + 1), "n")],
    ["a note", note("n", "n".repeat(MAX_TEXT + 1))],
    [
      "a list's name",
      run(
        "INSERT INTO categories (id, user_id, name) VALUES ('long', 'alice', ?)",
        "l".repeat(MAX_NAME + 1),
      ),
    ],
    [
      "a person's name",
      run(
        "INSERT INTO users (id, name, username, password_hash) VALUES ('long', ?, 'long', 'x')",
        "p".repeat(MAX_NAME + 1),
      ),
    ],
  ])("refuse %s one character past its limit", (_what, write) => {
    expect(write).toThrow(/CHECK constraint failed/);
  });

  test("take every field at its limit, counted in characters as the API counts them", () => {
    insertTask(sqlite, "longest", "t".repeat(MAX_TITLE), {
      description: "😀".repeat(MAX_TEXT),
      sort_order: `a0${"V".repeat(MAX_SORT_KEY - 2)}`,
    });
    note("😀".repeat(MAX_TITLE), "n".repeat(MAX_TEXT))();
    run(
      "INSERT INTO categories (id, user_id, name) VALUES ('longest', 'alice', ?)",
      "l".repeat(MAX_NAME),
    )();
    expect(sqlite.prepare("SELECT id FROM tasks WHERE id = 'longest'").all()).toHaveLength(1);
  });
});

describe("rows already past a limit", async () => {
  const sqlite = await database(before);
  const longTitle = "t".repeat(MAX_TITLE + 500);
  const longText = `${"a".repeat(MAX_TEXT)}${"b".repeat(MAX_TEXT)}${"c".repeat(20)}`;
  insertTask(sqlite, "titled", longTitle, { description: "What it's for" });
  insertTask(sqlite, "described", "Read", {
    description: longText,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  insertTask(sqlite, "keyed", "Keyed", { sort_order: `a0${"V".repeat(MAX_SORT_KEY + 10)}` });
  insertTask(sqlite, "next", "Next", { sort_order: "a1" });
  sqlite.exec(`INSERT INTO notes (id, user_id, task_id, title, content, created_at) VALUES
    ('pasted', 'alice', 'titled', '${longText}', '${longText}', '2026-02-01T00:00:00.000Z'),
    ('untitled', 'alice', 'titled', '${longTitle}', NULL, '2026-02-02T00:00:00.000Z')`);
  sqlite.exec(`INSERT INTO categories (id, user_id, name)
    VALUES ('named', 'alice', '${"l".repeat(300)}')`);
  const updatedAt = (sqlite.prepare("SELECT updated_at FROM tasks").all() as Row[]).map(
    (row) => row.updated_at,
  );
  await migrate(drizzle({ client: sqlite }), migrations);

  const task = (id: string) => sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row;
  const notesOf = (taskId: string) =>
    sqlite
      .prepare("SELECT * FROM notes WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as Row[];

  test("keep a task's whole title at the head of its description", () => {
    expect(task("titled").title).toBe(`${longTitle.slice(0, MAX_TITLE - 1)}…`);
    expect(task("titled").description).toBe(`${longTitle}\n\nWhat it's for`);
  });

  test("go on in notes of the task, in order, after the text the row keeps", () => {
    expect(task("described").description).toBe(longText.slice(0, MAX_TEXT));
    const continued = notesOf("described");
    expect(continued.map((row) => row.content).join("")).toBe(longText.slice(MAX_TEXT));
    expect(continued.every((row) => row.user_id === "alice")).toBe(true);
  });

  test("keep a note's whole text, and a title that was its only text", () => {
    const notes = notesOf("titled");
    expect(notes.map((row) => row.content)).toEqual([
      longTitle,
      longText.slice(0, MAX_TEXT),
      longText.slice(MAX_TEXT, MAX_TEXT * 2),
      longText.slice(MAX_TEXT * 2),
    ]);
    expect(notes.every((row) => String(row.title).length <= MAX_TITLE)).toBe(true);
  });

  test("cut a list's name, and keep the order of a table holding a key too long", () => {
    const list = sqlite.prepare("SELECT name FROM categories WHERE id = 'named'").get() as Row;
    expect(list.name).toBe(`${"l".repeat(MAX_NAME - 1)}…`);
    expect(String(task("keyed").sort_order) < String(task("next").sort_order)).toBe(true);
    expect(String(task("keyed").sort_order).length).toBeLessThanOrEqual(MAX_SORT_KEY);
  });

  test("leave updatedAt alone", () => {
    const now = (sqlite.prepare("SELECT updated_at FROM tasks").all() as Row[]).map(
      (row) => row.updated_at,
    );
    expect(now).toEqual(updatedAt);
  });
});
