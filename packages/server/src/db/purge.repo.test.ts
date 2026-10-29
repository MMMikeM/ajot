import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { hoursFromNow } from "@newtab-todo/shared/iso";
import { migrate } from "./migrator";
import { KEEP_DELETED_DAYS, KEEP_SENT_DAYS, purgeExpired } from "./purge.repo";
import {
  attachments,
  categories,
  categoryCollaborators,
  inviteTokens,
  notes,
  notificationQueue,
  removedCollaborators,
  removedContacts,
  sessions,
  tasks,
  taskShares,
  users,
} from "./schema";

// The client is unused here: purgeExpired is handed this file's own database
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

// Key to when it was last written
const objects = new Map<string, string>();
const bucket = {
  remove: async (key: string) => void objects.delete(key),
  list: async function* () {
    for (const [key, lastModified] of objects) yield { key, lastModified };
  },
};
const twoDaysAgo = hoursFromNow(-48);
const stored = (...keys: string[]) => {
  for (const key of keys) objects.set(key, twoDaysAgo);
};

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
      {
        ...reminder,
        id: "sent-long-ago",
        taskId: "live",
        sentAt: hoursFromNow(-(KEEP_SENT_DAYS + 1) * 24),
      },
      {
        ...reminder,
        id: "sent-lately",
        taskId: "live",
        sentAt: hoursFromNow(-(KEEP_SENT_DAYS - 1) * 24),
      },
      { ...reminder, id: "never-sent", taskId: "recent", scheduledFor: longAgo },
      { ...reminder, id: "due-lately", taskId: "in-held-list", scheduledFor: lately },
      { ...reminder, id: "due-later", taskId: "filed-by-bob", scheduledFor: hoursFromNow(24) },
    ])
    .run();
  db.insert(sessions)
    .values([
      { id: "session-expired", userId: "alice", expiresAt: hoursFromNow(-1) },
      { id: "session-live", userId: "alice", expiresAt: hoursFromNow(1) },
    ])
    .run();
  const invite = { createdByUserId: "alice", expiresAt: hoursFromNow(24) };
  db.insert(inviteTokens)
    .values([
      { ...invite, id: "used-long-ago", usedAt: longAgo, usedByUserId: "bob" },
      { ...invite, id: "used-lately", usedAt: lately, usedByUserId: "bob" },
      { ...invite, id: "expired-long-ago", expiresAt: longAgo },
      { ...invite, id: "expired-lately", expiresAt: lately },
      { ...invite, id: "unused" },
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

  const file = { uploaderId: "bob", name: "f.jpg", mimeType: "image/jpeg", size: 10 };
  const uploaded = { ...file, uploadedAt: longAgo };
  db.insert(attachments)
    .values([
      { ...uploaded, id: "att-of-old", taskId: "old" },
      { ...uploaded, id: "att-of-old-sub", taskId: "old-sub" },
      { ...uploaded, id: "att-deleted-long-ago", taskId: "live", deletedAt: longAgo },
      { ...uploaded, id: "att-deleted-lately", taskId: "live", deletedAt: lately },
      { ...uploaded, id: "att-live", taskId: "live" },
      { ...file, id: "att-abandoned", taskId: "live", createdAt: twoDaysAgo },
      { ...file, id: "att-uploading", taskId: "live" },
    ])
    .run();
  stored(
    "a/att-of-old",
    "t/att-of-old",
    "a/att-of-old-sub",
    "a/att-deleted-long-ago",
    "a/att-deleted-lately",
    "a/att-live",
    "u/a/att-live",
    "u/a/att-abandoned",
    "a/no-row",
  );
  objects.set("u/a/att-uploading", hoursFromNow(0));
  objects.set("a/just-copied", hoursFromNow(0));

  purged = await purgeExpired(db, bucket);
});

describe("purging deleted tasks", () => {
  test("takes a task deleted long ago, with its subtasks, notes, shares and reminders", () => {
    expect(ids("tasks")).not.toContain("old");
    expect(ids("tasks")).not.toContain("old-sub");
    expect(ids("notes")).toEqual(["note-live"]);
    expect(ids("task_shares")).toEqual(["share-filed"]);
    expect(ids("notification_queue")).not.toContain("remind-old");
    expect(ids("notification_queue")).toContain("remind-live");
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

  test("keeps a parent whose subtask was deleted lately, which it would cascade to", () => {
    expect(ids("tasks")).toEqual(expect.arrayContaining(["has-recent-sub", "recent-sub"]));
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

describe("purging what's expired", () => {
  test("takes sessions past their expiry and keeps the rest", () => {
    expect(ids("sessions")).toEqual(["session-live"]);
    expect(purged.sessions).toBe(1);
  });

  test("takes invites used or expired long ago, and keeps the rest", () => {
    expect(ids("invite_tokens")).toEqual(["expired-lately", "unused", "used-lately"]);
    expect(purged.invites).toBe(2);
  });

  test("takes notifications sent long ago or never sent though due long ago", () => {
    expect(ids("notification_queue")).toEqual([
      "due-lately",
      "due-later",
      "remind-live",
      "sent-lately",
    ]);
    expect(purged.notifications).toBe(2);
  });
});

describe("purging attachments", () => {
  test("takes the bytes of a purged task's attachments and its subtasks', and their rows go with it", () => {
    expect(objects.has("a/att-of-old")).toBe(false);
    expect(objects.has("t/att-of-old")).toBe(false);
    expect(objects.has("a/att-of-old-sub")).toBe(false);
    expect(ids("attachments")).not.toContain("att-of-old");
  });

  test("takes the bytes of one deleted long ago and keeps its row, marked purged", () => {
    expect(objects.has("a/att-deleted-long-ago")).toBe(false);
    const row = sqlite.prepare(
      "SELECT purged_at FROM attachments WHERE id = 'att-deleted-long-ago'",
    );
    expect(row.get()).toEqual({ purged_at: expect.any(String) });
  });

  test("takes an upload abandoned over a day ago, row and bytes", () => {
    expect(ids("attachments")).not.toContain("att-abandoned");
    expect(objects.has("u/a/att-abandoned")).toBe(false);
  });

  test("takes a day-old staged copy and bytes no confirmed row owns, and nothing newer", () => {
    expect([...objects.keys()].sort()).toEqual([
      "a/att-deleted-lately",
      "a/att-live",
      "a/just-copied",
      "u/a/att-uploading",
    ]);
    expect(purged.attachments).toEqual({ ofPurgedTasks: 2, deleted: 1, unfinished: 1, strays: 2 });
  });

  test("keeps the rows of a live one, one deleted lately and one still uploading", () => {
    expect(ids("attachments")).toEqual(
      expect.arrayContaining(["att-live", "att-deleted-lately", "att-uploading"]),
    );
  });

  test("a step whose bucket call fails is logged, and the rest of the purge still runs", async () => {
    db.insert(attachments)
      .values({
        id: "att-again",
        taskId: "live",
        uploaderId: "bob",
        name: "f",
        mimeType: "x",
        size: 1,
        uploadedAt: longAgo,
        deletedAt: longAgo,
      })
      .run();
    const failing = { ...bucket, remove: async () => Promise.reject(new Error("bucket down")) };
    const again = await purgeExpired(db, failing);
    expect(again.attachments?.deleted).toBe("failed");
    expect(again.sessions).toBe(0);
    expect(
      sqlite.prepare("SELECT purged_at FROM attachments WHERE id = 'att-again'").get(),
    ).toEqual({
      purged_at: null,
    });
  });
});

test("leaves no row pointing at one that's gone", () => {
  expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});
