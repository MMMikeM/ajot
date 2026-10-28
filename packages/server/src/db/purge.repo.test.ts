import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import { migrate } from "./migrator";
import { KEEP_DELETED_DAYS, purgeExpired } from "./purge.repo";
import {
  categories,
  categoryCollaborators,
  notes,
  notificationQueue,
  removedCollaborators,
  removedContacts,
  tasks,
  taskShares,
  users,
} from "./schema";

// Each test hands the purge its own database
vi.mock("./client", () => ({ db: undefined }));

// The foreign keys decide what a purge takes with it, so it runs against the real migrations,
// as task-access.test.ts does, rather than a fake that can't cascade
const sqlite = new DatabaseSync(":memory:");
const db = drizzle({ client: sqlite });
await migrate(db, fileURLToPath(new URL("../../drizzle", import.meta.url)));

const longAgo = hoursFromNow(-(KEEP_DELETED_DAYS + 1) * 24);
const lately = hoursFromNow(-(KEEP_DELETED_DAYS - 1) * 24);

const ids = (table: string) =>
  (sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map(
    (r) => r.id,
  );

let purged: Awaited<ReturnType<typeof purgeExpired>>;

beforeAll(async () => {
  db.insert(users)
    .values(["alice", "bob"].map((id) => ({ id, name: id, username: id, passwordHash: "x" })))
    .run();
  db.insert(categories)
    .values([
      { id: "live-list", userId: "alice", name: "Live" },
      { id: "old-list", userId: "alice", name: "Deleted long ago", deletedAt: longAgo },
      { id: "recent-list", userId: "alice", name: "Deleted lately", deletedAt: lately },
      { id: "holds-a-task", userId: "alice", name: "Still holds a task", deletedAt: longAgo },
      { id: "holds-a-share", userId: "bob", name: "Still holds a share", deletedAt: longAgo },
    ])
    .run();
  db.insert(categoryCollaborators)
    .values([
      { id: "cc-old", categoryId: "old-list", userId: "bob" },
      { id: "cc-live", categoryId: "live-list", userId: "bob" },
    ])
    .run();
  db.insert(tasks)
    .values([
      { id: "live", userId: "alice", title: "Live" },
      { id: "old", userId: "alice", title: "Deleted long ago", deletedAt: longAgo },
      { id: "old-sub", userId: "alice", parentId: "old", title: "With it", deletedAt: longAgo },
      { id: "recent", userId: "alice", title: "Deleted lately", deletedAt: lately },
      { id: "sub-of-live", userId: "alice", parentId: "live", title: "Old", deletedAt: longAgo },
      { id: "has-live-sub", userId: "alice", title: "Deleted long ago", deletedAt: longAgo },
      { id: "live-sub", userId: "bob", parentId: "has-live-sub", title: "Restored on its own" },
      { id: "has-recent-sub", userId: "alice", title: "Deleted long ago", deletedAt: longAgo },
      {
        id: "recent-sub",
        userId: "alice",
        parentId: "has-recent-sub",
        title: "Deleted lately",
        deletedAt: lately,
      },
      {
        id: "in-old-list",
        userId: "alice",
        categoryId: "old-list",
        title: "Deleted with the list",
        deletedAt: longAgo,
      },
      { id: "in-held-list", userId: "alice", categoryId: "holds-a-task", title: "Live" },
      { id: "filed-by-bob", userId: "alice", title: "Shared with Bob" },
    ])
    .run();
  db.insert(notes)
    .values([
      { id: "note-old", userId: "bob", taskId: "old", title: "On a purged task" },
      { id: "note-live", userId: "bob", taskId: "live", title: "On a live task" },
    ])
    .run();
  db.insert(taskShares)
    .values([
      { id: "share-old", taskId: "old", sharedWithUserId: "bob" },
      {
        id: "share-filed",
        taskId: "filed-by-bob",
        sharedWithUserId: "bob",
        categoryId: "holds-a-share",
      },
    ])
    .run();
  const reminder = { userId: "alice", type: "reminder-due" as const, scheduledFor: "x" };
  db.insert(notificationQueue)
    .values([
      { ...reminder, id: "remind-old", taskId: "old" },
      { ...reminder, id: "remind-live", taskId: "live" },
    ])
    .run();
  const pastTheHour = hoursFromNow(-2);
  const removedContact = { userId: "alice", contacts: [], collaborators: [] };
  db.insert(removedContacts)
    .values([
      { ...removedContact, id: "rc-old", removedAt: pastTheHour },
      { ...removedContact, id: "rc-new", removedAt: hoursFromNow(-0.5) },
    ])
    .run();
  const removed = { userId: "bob", addedAt: "then", movedTaskIds: [], unfiledTaskIds: [] };
  db.insert(removedCollaborators)
    .values([
      { ...removed, id: "rx-old", categoryId: "live-list", removedAt: pastTheHour },
      { ...removed, id: "rx-new", categoryId: "recent-list" },
    ])
    .run();

  purged = await purgeExpired(db);
});

describe("purging deleted tasks", () => {
  test("takes a task deleted long ago, with its subtasks, notes, shares and reminders", () => {
    expect(ids("tasks")).not.toContain("old");
    expect(ids("tasks")).not.toContain("old-sub");
    expect(ids("notes")).toEqual(["note-live"]);
    expect(ids("task_shares")).toEqual(["share-filed"]);
    expect(ids("notification_queue")).toEqual(["remind-live"]);
  });

  test("takes a subtask deleted long ago from under a live parent", () => {
    expect(ids("tasks")).not.toContain("sub-of-live");
    expect(ids("tasks")).toContain("live");
  });

  test("keeps a task deleted lately, and every live one", () => {
    expect(ids("tasks")).toEqual(
      expect.arrayContaining(["live", "recent", "in-held-list", "filed-by-bob"]),
    );
  });

  test("keeps a parent whose subtask is live or deleted lately, which it would cascade to", () => {
    expect(ids("tasks")).toEqual(
      expect.arrayContaining(["has-live-sub", "live-sub", "has-recent-sub", "recent-sub"]),
    );
  });
});

describe("purging deleted lists", () => {
  test("takes a list deleted long ago, with its collaborators and its deleted tasks", () => {
    expect(ids("categories")).not.toContain("old-list");
    expect(ids("tasks")).not.toContain("in-old-list");
    expect(ids("category_collaborators")).toEqual(["cc-live"]);
  });

  test("keeps a list deleted lately, and one a live task or share is still filed in", () => {
    expect(ids("categories")).toEqual([
      "holds-a-share",
      "holds-a-task",
      "live-list",
      "recent-list",
    ]);
    const share = sqlite.prepare("SELECT category_id FROM task_shares WHERE id = 'share-filed'");
    expect(share.get()).toEqual({ category_id: "holds-a-share" });
  });
});

describe("purging Undo records", () => {
  test("takes those past their hour and keeps the rest", () => {
    expect(ids("removed_contacts")).toEqual(["rc-new"]);
    expect(ids("removed_collaborators")).toEqual(["rx-new"]);
    expect(purged.undoRecords).toEqual({ contacts: 1, collaborators: 1 });
  });
});

test("leaves no row pointing at one that's gone", () => {
  expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
