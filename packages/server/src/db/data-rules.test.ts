import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { migrate } from "./migrator";

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url));
const before = mkdtempSync(join(tmpdir(), "ajot-data-rules-"));
const BASE = "20261028102944_length_limits";
for (const name of readdirSync(migrations).filter((name) => name <= BASE))
  cpSync(join(migrations, name), join(before, name), { recursive: true });
afterAll(() => rmSync(before, { recursive: true }));

type Row = Record<string, unknown>;

const database = async (folder: string) => {
  const sqlite = new DatabaseSync(":memory:");
  await migrate(drizzle({ client: sqlite }), folder);
  sqlite.exec(`INSERT INTO users (id, name, username, password_hash)
    VALUES ('alice', 'Alice', 'alice', 'x'), ('bob', 'Bob', 'bob', 'x')`);
  return sqlite;
};

const ids = (sqlite: DatabaseSync, sql: string) =>
  (sqlite.prepare(sql).all() as Row[]).map((row) => row.id);

describe("the constraints", async () => {
  const sqlite = await database(migrations);
  sqlite.exec(`INSERT INTO tasks (id, user_id, title, due_date) VALUES
      ('top', 'alice', 'Top', '2026-11-01'), ('other', 'alice', 'Other', NULL);
    INSERT INTO tasks (id, user_id, parent_id, title) VALUES ('sub', 'alice', 'top', 'Sub');
    INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for) VALUES
      ('pending', 'alice', 'reminder-due', 'top', '2026-11-01');
    INSERT INTO notification_queue (id, user_id, type, scheduled_for, sent_at) VALUES
      ('digest', 'alice', 'overdue-digest', '2026-10-28T08:00:00.000Z', '2026-10-28T08:00:00.000Z')`);
  const run = (sql: string) => () => sqlite.exec(sql);

  test.each([
    [
      "a contact with yourself",
      "INSERT INTO contacts (id, user_id, contact_user_id) VALUES ('c', 'alice', 'alice')",
      /CHECK constraint failed: contact_is_someone_else/,
    ],
    [
      "a second unsent reminder for a task",
      `INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for)
        VALUES ('again', 'alice', 'reminder-due', 'top', '2026-11-02')`,
      /UNIQUE constraint failed/,
    ],
    [
      "a second digest for someone the same UTC day",
      `INSERT INTO notification_queue (id, user_id, type, scheduled_for, sent_at) VALUES
        ('again', 'alice', 'overdue-digest', '2026-10-28T23:00:00.000Z', '2026-10-28T23:00:00.000Z')`,
      /UNIQUE constraint failed/,
    ],
    [
      "a reminder without a task",
      `INSERT INTO notification_queue (id, user_id, type, scheduled_for)
        VALUES ('bare', 'alice', 'reminder-due', '2026-11-01')`,
      /CHECK constraint failed: only_reminders_have_a_task/,
    ],
    [
      "a digest with a task",
      `INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for)
        VALUES ('tasked', 'alice', 'overdue-digest', 'other', '2026-10-29T08:00:00.000Z')`,
      /CHECK constraint failed: only_reminders_have_a_task/,
    ],
    [
      "a subtask of a subtask",
      "INSERT INTO tasks (id, user_id, parent_id, title) VALUES ('deeper', 'alice', 'sub', 'No')",
      /FOREIGN KEY constraint failed/,
    ],
    [
      "a task with subtasks becoming one",
      "UPDATE tasks SET parent_id = 'other' WHERE id = 'top'",
      /FOREIGN KEY constraint failed/,
    ],
    [
      "an empty attachment",
      `INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size)
        VALUES ('empty', 'top', 'alice', 'a.txt', 'text/plain', 0)`,
      /CHECK constraint failed: attachment_size/,
    ],
    [
      "an attachment over the ceiling",
      `INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size)
        VALUES ('huge', 'top', 'alice', 'a.bin', 'application/octet-stream', 104857601)`,
      /CHECK constraint failed: attachment_size/,
    ],
    [
      "an attachment's bytes purged while it's live",
      `INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size, uploaded_at, purged_at)
        VALUES ('live', 'top', 'alice', 'a.jpg', 'image/jpeg', 10, '2026-10-01', '2026-10-02')`,
      /CHECK constraint failed: attachment_purged_once_uploaded_and_deleted/,
    ],
    [
      "an attachment's bytes purged before they were uploaded",
      `INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size, deleted_at, purged_at)
        VALUES ('never', 'top', 'alice', 'a.jpg', 'image/jpeg', 10, '2026-10-01', '2026-10-02')`,
      /CHECK constraint failed: attachment_purged_once_uploaded_and_deleted/,
    ],
    [
      "an attachment's name past 255 characters",
      `INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size)
        VALUES ('long', 'top', 'alice', '${"a".repeat(256)}', 'text/plain', 1)`,
      /CHECK constraint failed: attachment_name_length/,
    ],
  ])("refuse %s", (_what, sql, error) => {
    expect(run(sql)).toThrow(error);
  });

  test("take what the app writes", () => {
    sqlite.exec(`INSERT INTO contacts (id, user_id, contact_user_id) VALUES ('c', 'alice', 'bob');
      UPDATE notification_queue SET sent_at = '2026-11-01T00:00:00.000Z' WHERE id = 'pending';
      INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for) VALUES
        ('next', 'alice', 'reminder-due', 'top', '2026-11-08'),
        ('other-task', 'alice', 'reminder-due', 'other', '2026-11-08');
      INSERT INTO notification_queue (id, user_id, type, scheduled_for, sent_at) VALUES
        ('tomorrow', 'alice', 'overdue-digest', '2026-10-29T00:00:00.000Z', '2026-10-29T00:00:00.000Z'),
        ('bobs', 'bob', 'overdue-digest', '2026-10-28T08:00:00.000Z', '2026-10-28T08:00:00.000Z');
      INSERT INTO tasks (id, user_id, parent_id, title) VALUES ('sub2', 'alice', 'other', 'Sub');
      INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size)
        VALUES ('photo', 'top', 'bob', 'photo.jpg', 'image/jpeg', 104857600);
      UPDATE attachments SET uploaded_at = '2026-10-01' WHERE id = 'photo';
      UPDATE attachments SET deleted_at = '2026-10-02' WHERE id = 'photo';
      UPDATE attachments SET purged_at = '2026-11-01' WHERE id = 'photo'`);
    expect(ids(sqlite, "SELECT id FROM attachments")).toEqual(["photo"]);
    expect(ids(sqlite, "SELECT id FROM notification_queue ORDER BY id")).toEqual([
      "bobs",
      "digest",
      "next",
      "other-task",
      "pending",
      "tomorrow",
    ]);
  });
});

describe("rows already breaking them", async () => {
  const sqlite = await database(before);
  sqlite.exec(`INSERT INTO users (id, name, username, password_hash)
      VALUES ('carol', 'Carol', 'carol', 'x');
    INSERT INTO contacts (id, user_id, contact_user_id) VALUES
      ('self', 'alice', 'alice'), ('ab', 'alice', 'bob'), ('ba', 'bob', 'alice');
    INSERT INTO removed_contacts (id, user_id, contacts, collaborators) VALUES
      ('removed-self', 'alice',
        '[{"id":"removed-self","userId":"alice","contactUserId":"alice","createdAt":"then"}]', '[]'),
      ('removed-carol', 'alice',
        '[{"id":"removed-carol","userId":"alice","contactUserId":"carol","createdAt":"then"},
          {"id":"carol-alice","userId":"carol","contactUserId":"alice","createdAt":"then"}]', '[]');
    INSERT INTO tasks (id, user_id, title, due_date) VALUES
      ('top', 'alice', 'Top', '2026-11-01'), ('later', 'alice', 'Later', '2026-11-05'),
      ('undated', 'alice', 'Undated', NULL);
    INSERT INTO tasks (id, user_id, parent_id, title, sort_order, updated_at) VALUES
      ('sub', 'alice', 'top', 'Sub', 'a0', '2026-01-01T00:00:00.000Z'),
      ('grandchild', 'alice', 'sub', 'Grandchild', 'a1', '2026-01-02T00:00:00.000Z'),
      ('great', 'alice', 'grandchild', 'Great', 'a2', '2026-01-03T00:00:00.000Z');
    INSERT INTO notes (id, user_id, task_id, title) VALUES ('note', 'alice', 'great', 'Kept');
    INSERT INTO tasks (id, user_id, title) VALUES
      ('loop-x', 'alice', 'X'), ('loop-y', 'alice', 'Y'), ('loop-z', 'alice', 'Z'),
      ('loop-w', 'alice', 'W');
    UPDATE tasks SET parent_id = CASE id WHEN 'loop-x' THEN 'loop-y' WHEN 'loop-y' THEN 'loop-x'
      WHEN 'loop-z' THEN 'loop-x' WHEN 'loop-w' THEN 'loop-z' END WHERE id LIKE 'loop-%';
    INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for, sent_at, created_at)
      VALUES
      ('for-due-date', 'alice', 'reminder-due', 'top', '2026-11-01', NULL, '2026-10-01T00:00:00.000Z'),
      ('stale', 'alice', 'reminder-due', 'top', '2026-10-30', NULL, '2026-10-02T00:00:00.000Z'),
      ('sent', 'alice', 'reminder-due', 'top', '2026-10-20', '2026-10-20', '2026-09-01T00:00:00.000Z'),
      ('older', 'alice', 'reminder-due', 'later', '2026-11-04', NULL, '2026-10-01T00:00:00.000Z'),
      ('newer', 'alice', 'reminder-due', 'later', '2026-11-03', NULL, '2026-10-02T00:00:00.000Z'),
      ('taskless', 'alice', 'reminder-due', NULL, '2026-11-01', NULL, '2026-10-01T00:00:00.000Z'),
      ('undated-pending', 'alice', 'reminder-due', 'undated', '2026-11-01', NULL, '2026-10-01T00:00:00.000Z'),
      ('undated-sent', 'alice', 'reminder-due', 'undated', '2026-10-01', '2026-10-01', '2026-09-01T00:00:00.000Z');
    INSERT INTO notification_queue (id, user_id, type, task_id, scheduled_for, sent_at) VALUES
      ('first', 'alice', 'overdue-digest', NULL, '2026-10-28T08:00:00.000Z', '2026-10-28T08:00:00.000Z'),
      ('second', 'alice', 'overdue-digest', 'top', '2026-10-28T08:00:01.000Z', '2026-10-28T08:00:01.000Z'),
      ('next-day', 'alice', 'overdue-digest', 'top', '2026-10-29T08:00:00.000Z', '2026-10-29T08:00:00.000Z'),
      ('bobs', 'bob', 'overdue-digest', NULL, '2026-10-28T08:00:00.000Z', '2026-10-28T08:00:00.000Z')`);
  const tasksBefore = sqlite.prepare("SELECT * FROM tasks ORDER BY id").all() as Row[];
  await migrate(drizzle({ client: sqlite }), migrations);

  const task = (id: string) => sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row;

  test("lose a contact with yourself and its Undo record, and nothing else", () => {
    expect(ids(sqlite, "SELECT id FROM contacts ORDER BY id")).toEqual(["ab", "ba"]);
    expect(ids(sqlite, "SELECT id FROM removed_contacts")).toEqual(["removed-carol"]);
  });

  test("keep one unsent reminder a dated task, for its due date or else the newest, and every sent one", () => {
    expect(
      ids(sqlite, "SELECT id FROM notification_queue WHERE type = 'reminder-due' ORDER BY id"),
    ).toEqual(["for-due-date", "newer", "sent", "undated-sent"]);
  });

  test("keep the first digest of someone's day, and none with a task", () => {
    const digests = sqlite
      .prepare(
        "SELECT id, task_id FROM notification_queue WHERE type = 'overdue-digest' ORDER BY id",
      )
      .all();
    expect(digests).toEqual([
      { id: "bobs", task_id: null },
      { id: "first", task_id: null },
      { id: "next-day", task_id: null },
    ]);
  });

  test("move a subtask's subtasks up to its top-level task, changing nothing else", () => {
    expect(task("grandchild").parent_id).toBe("top");
    expect(task("great").parent_id).toBe("top");
    expect(task("sub").parent_id).toBe("top");
    const unchanged = (rows: Row[]) =>
      rows.map(({ parent_id: _p, live: _l, top_level: _t, has_parent: _h, ...rest }) => rest);
    expect(unchanged(sqlite.prepare("SELECT * FROM tasks ORDER BY id").all() as Row[])).toEqual(
      unchanged(tasksBefore),
    );
    expect(ids(sqlite, "SELECT id FROM notes")).toEqual(["note"]);
  });

  test("make a loop's tasks, and those under it, top-level", () => {
    expect(
      sqlite.prepare("SELECT id, parent_id FROM tasks WHERE id LIKE 'loop-%' ORDER BY id").all(),
    ).toEqual(["loop-w", "loop-x", "loop-y", "loop-z"].map((id) => ({ id, parent_id: null })));
  });

  test("leave no row pointing at one that's gone", () => {
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
