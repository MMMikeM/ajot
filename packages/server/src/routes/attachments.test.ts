import type { Context } from "hono";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { broadcast, broadcastAll, broadcastPerUser } from "../broadcast";
import * as reachRepo from "../db/reach.repo";
import { attachmentRoutes } from "./attachments";
import { sendReachChanges } from "./reach";
import { taskRoutes } from "./tasks";

// Mock factories run before this file's imports, so what they hand out is built here, with
// dynamic imports. Who sees what is decided in SQL (task_access, rows not yet uploaded), so the
// routes run against the real migrations rather than mocked repos.
const { sqlite, me, bucket } = await vi.hoisted(async () => {
  process.env.ATTACHMENT_QUOTA_MB = "1";
  const { DatabaseSync } = await import("node:sqlite");
  const { fileURLToPath } = await import("node:url");
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { relations } = await import("../db/schema");
  const { migrate } = await import("../db/migrator");
  const sqlite = new DatabaseSync(":memory:");
  const db = drizzle({ client: sqlite, relations });
  await migrate(db, fileURLToPath(new URL("../../drizzle", import.meta.url)));
  return { sqlite, db, me: { id: "alice" }, bucket: new Map<string, number>() };
});

vi.mock("../db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-sqlite");
  const { relations } = await import("../db/schema");
  return { db: drizzle({ client: sqlite, relations }), inTransaction: vi.fn() };
});
vi.mock("../auth", () => ({ extractToken: () => "token", validateSession: async () => me.id }));
vi.mock("../broadcast", () => ({
  broadcast: vi.fn(),
  broadcastAll: vi.fn(),
  broadcastPerUser: vi.fn(),
}));
vi.mock("../storage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  storage: {
    presignPut: async (key: string, size: number, type: string) => `put ${key} ${size} ${type}`,
    presignGet: async (key: string, disposition: string) => `get ${key} ${disposition}`,
    sizeOf: async (key: string) => bucket.get(key),
    copy: async (from: string, to: string) => void bucket.set(to, bucket.get(from)!),
    remove: async (key: string) => void bucket.delete(key),
  },
}));

const at = "2026-10-29T09:00:00.000Z";

sqlite.exec(`
  INSERT INTO users (id, name, username, password_hash) VALUES
    ('alice', 'Alice', 'alice', 'x'), ('bob', 'Bob', 'bob', 'x'),
    ('carol', 'Carol', 'carol', 'x'), ('dave', 'Dave', 'dave', 'x');
  INSERT INTO tasks (id, user_id, title) VALUES ('shared', 'alice', 'Shared');
  INSERT INTO tasks (id, user_id, title, deleted_at) VALUES ('gone', 'alice', 'Gone', '${at}');
  INSERT INTO task_shares (id, task_id, shared_with_user_id, permission) VALUES
    ('s1', 'shared', 'bob', 'edit'), ('s2', 'shared', 'carol', 'view')`);

const body = async <T>(response: Response | Promise<Response>) =>
  (await (await response).json()) as T;

const as = (userId: string) => {
  me.id = userId;
  const send = (method: string, path: string, body: object) =>
    attachmentRoutes.request(path, {
      method,
      headers: { authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    add: (id: string, fields: object = {}) =>
      send("POST", "/", {
        id,
        taskId: "shared",
        name: `${id}.jpg`,
        mimeType: "image/jpeg",
        size: 1000,
        hasThumb: false,
        createdAt: at,
        updatedAt: at,
        ...fields,
      }),
    list: async () =>
      (
        await body<{ id: string }[]>(
          attachmentRoutes.request("/", { headers: { authorization: "Bearer t" } }),
        )
      ).map((row) => row.id),
    uploadUrl: (id: string, thumbSize?: number) => send("POST", "/upload-url", { id, thumbSize }),
    complete: (id: string) => send("POST", "/complete", { id }),
    remove: (id: string) => send("DELETE", "/", { id }),
    restore: (id: string) => send("PUT", "/", { id }),
    urls: (ids: string[], variant = "file") => send("POST", "/urls", { ids, variant }),
  };
};

const uploaded = async (userId: string, id: string, fields: { size?: number } = {}) => {
  expect((await as(userId).add(id, fields)).status).toBe(200);
  bucket.set(`u/a/${id}`, fields.size ?? 1000);
  expect((await as(userId).complete(id)).status).toBe(200);
};

const announcedTo = () => [...(vi.mocked(broadcast).mock.lastCall?.[4] ?? [])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  sqlite.exec("DELETE FROM attachments");
  bucket.clear();
});

describe("adding", () => {
  test("whoever edits the task adds; someone it's shared with to view can't; a stranger gets 404", async () => {
    expect((await as("bob").add("b1")).status).toBe(200);
    expect((await as("carol").add("c1")).status).toBe(403);
    expect((await as("dave").add("d1")).status).toBe(404);
  });

  test("a retry gets its row back; another's id is 409; a deleted one is 410", async () => {
    await as("bob").add("b1");
    expect((await as("bob").add("b1")).status).toBe(200);
    expect((await as("alice").add("b1")).status).toBe(409);
    await as("bob").remove("b1");
    expect((await as("bob").add("b1")).status).toBe(410);
  });

  test("a deleted task is 410, one that doesn't exist 404", async () => {
    expect((await as("alice").add("a1", { taskId: "gone" })).status).toBe(410);
    expect((await as("alice").add("a2", { taskId: "nowhere" })).status).toBe(404);
  });

  test("a file over the cap, or over the uploader's quota, is 413", async () => {
    expect((await as("alice").add("big", { size: 26 * 1024 * 1024 })).status).toBe(413);
    expect((await as("alice").add("half", { size: 600 * 1024 })).status).toBe(200);
    expect((await as("alice").add("more", { size: 600 * 1024 })).status).toBe(413);
    expect((await as("bob").add("bobs", { size: 600 * 1024 })).status).toBe(200);
  });
});

describe("uploading", () => {
  test("until /complete, only the uploader lists it, and it's announced to them alone", async () => {
    await as("bob").add("b1");
    expect(await as("bob").list()).toEqual(["b1"]);
    expect(await as("alice").list()).toEqual([]);
    expect(announcedTo()).toEqual(["bob"]);
  });

  test("/complete shows it to everyone who sees the task, and only them", async () => {
    await uploaded("bob", "b1");
    expect(announcedTo()).toEqual(["alice", "bob", "carol"]);
    for (const userId of ["alice", "bob", "carol"]) expect(await as(userId).list()).toEqual(["b1"]);
    expect(await as("dave").list()).toEqual([]);
  });

  test("an upload URL holds the PUT to the row's size, as a download for a type that doesn't open in a tab", async () => {
    await as("bob").add("page", { name: "page.html", mimeType: "text/html", size: 5 });
    expect(await (await as("bob").uploadUrl("page")).json()).toEqual({
      file: "put u/a/page 5 application/octet-stream",
    });
  });

  test("an upload URL is the uploader's alone, and not for a row already uploaded", async () => {
    await as("bob").add("b1");
    expect((await as("alice").uploadUrl("b1")).status).toBe(404);
    bucket.set("u/a/b1", 1000);
    await as("bob").complete("b1");
    expect((await as("bob").uploadUrl("b1")).status).toBe(409);
  });

  test("a row with a thumbnail needs its size, which the thumbnail's URL is signed to", async () => {
    await as("bob").add("b1", { hasThumb: true });
    expect((await as("bob").uploadUrl("b1")).status).toBe(400);
    expect((await body<{ thumb?: string }>(as("bob").uploadUrl("b1", 20_000))).thumb).toBe(
      "put u/t/b1 20000 image/jpeg",
    );
  });

  test("a row without a thumbnail gets no thumbnail URL, whatever size it asks for", async () => {
    await as("bob").add("b1");
    expect(
      (await body<{ thumb?: string }>(as("bob").uploadUrl("b1", 20_000))).thumb,
    ).toBeUndefined();
  });

  test("/complete serves a copy of what it checked, so a later PUT to the upload URL changes nothing", async () => {
    await uploaded("bob", "b1");
    expect([...bucket.keys()]).toEqual(["a/b1"]);
  });

  test("an id that isn't plain letters, digits, - or _ is refused, since it's part of a bucket key", async () => {
    for (const id of ["b1#x", "../b1", "b1?x", "b 1"])
      expect((await as("bob").add(id)).status, id).toBe(400);
  });

  test("bytes that aren't the size it claimed are deleted, and /complete is 400", async () => {
    await as("bob").add("b1");
    expect((await as("bob").complete("b1")).status).toBe(400);
    bucket.set("u/a/b1", 999);
    expect((await as("bob").complete("b1")).status).toBe(400);
    expect(bucket.size).toBe(0);
    expect(await as("alice").list()).toEqual([]);
  });

  test("a /complete retried after it landed answers again", async () => {
    await uploaded("bob", "b1");
    expect((await as("bob").complete("b1")).status).toBe(200);
  });
});

describe("deleting", () => {
  test("its uploader or the task's owner deletes it; someone else who edits can't, nor a viewer", async () => {
    await uploaded("bob", "b1");
    expect((await as("carol").remove("b1")).status).toBe(403);
    await uploaded("alice", "a1");
    expect((await as("bob").remove("a1")).status).toBe(403);
    expect((await as("bob").remove("b1")).status).toBe(200);
    expect((await as("alice").remove("a1")).status).toBe(200);
    expect(await as("carol").list()).toEqual([]);
  });

  test("Undo restores it for everyone; a purged one is gone for good", async () => {
    await uploaded("bob", "b1");
    await as("bob").remove("b1");
    expect((await as("alice").restore("b1")).status).toBe(200);
    expect(await as("carol").list()).toEqual(["b1"]);
    await as("bob").remove("b1");
    sqlite.exec(`UPDATE attachments SET purged_at = '${at}' WHERE id = 'b1'`);
    expect((await as("bob").restore("b1")).status).toBe(410);
  });
});

describe("download URLs", () => {
  test("only for attachments the asker sees, in a tab only for the allowlisted types", async () => {
    await uploaded("bob", "photo");
    await as("bob").add("page", { name: "page's.html", mimeType: "text/html", size: 5 });
    bucket.set("u/a/page", 5);
    await as("bob").complete("page");
    const urls = async (userId: string) =>
      Object.fromEntries(
        (await body<{ id: string; url: string }[]>(as(userId).urls(["photo", "page"]))).map((u) => [
          u.id,
          u.url,
        ]),
      );
    expect(await urls("carol")).toEqual({
      photo: "get a/photo inline; filename*=UTF-8''photo.jpg",
      page: "get a/page attachment; filename*=UTF-8''page%27s.html",
    });
    expect(await urls("dave")).toEqual({});
  });
});

test("whoever gains a task gets its uploaded attachments, and whoever loses it has them taken off", async () => {
  await uploaded("bob", "b1");
  await as("bob").add("b2");
  const before = await reachRepo.read({ taskIds: ["shared"] });
  sqlite.exec(`UPDATE task_shares SET shared_with_user_id = 'dave' WHERE id = 's2'`);
  try {
    await sendReachChanges({} as Context, before);
  } finally {
    sqlite.exec(`UPDATE task_shares SET shared_with_user_id = 'carol' WHERE id = 's2'`);
  }
  const sent = vi.mocked(broadcastPerUser).mock.calls[0]?.[1] ?? [];
  expect(
    sent
      .filter(({ event }) => event.model === "attachments")
      .map(({ userId, event }) => [userId, event.action, (event.data as { id: string }).id]),
  ).toEqual([
    ["dave", "insert", "b1"],
    ["carol", "delete", "b1"],
  ]);
});

test("a restored task comes back with its attachments", async () => {
  sqlite.exec(`INSERT INTO attachments (id, task_id, uploader_id, name, mime_type, size, uploaded_at)
    VALUES ('kept', 'gone', 'alice', 'kept.jpg', 'image/jpeg', 10, '${at}')`);
  me.id = "alice";
  const res = await taskRoutes.request("/", {
    method: "PUT",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify({ id: "gone", updatedAt: at, deletedAt: null }),
  });
  sqlite.exec(`UPDATE tasks SET deleted_at = '${at}' WHERE id = 'gone'`);
  expect(res.status).toBe(200);
  const [, events] = vi.mocked(broadcastAll).mock.calls[0] ?? [];
  expect(events?.map((e) => [e.model, (e.data as { id: string }).id])).toEqual([
    ["tasks", "gone"],
    ["attachments", "kept"],
  ]);
});

test("a task someone reaches two ways lists its attachments once", async () => {
  await uploaded("bob", "b1");
  sqlite.exec(`INSERT INTO categories (id, user_id, name) VALUES ('home', 'alice', 'Home');
    UPDATE tasks SET category_id = 'home' WHERE id = 'shared'`);
  try {
    expect(await as("alice").list()).toEqual(["b1"]);
    expect(await body<unknown[]>(as("alice").urls(["b1"]))).toHaveLength(1);
  } finally {
    sqlite.exec(`UPDATE tasks SET category_id = NULL WHERE id = 'shared';
      DELETE FROM categories WHERE id = 'home'`);
  }
});
