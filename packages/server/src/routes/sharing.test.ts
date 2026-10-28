import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import taskRepo from "../db/task.repo";
import contactRepo from "../db/contact.repo";
import categoryCollaboratorRepo from "../db/category-collaborator.repo";
import { broadcast } from "../broadcast";
import { sendNotification } from "../notify";
import { sendReachChanges } from "./reach";
import { requireList, requireTask } from "./task-users";
import { taskRoutes } from "./tasks";
import { categoryRoutes } from "./categories";

vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("../db/task.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: {
    insert: vi.fn(),
    insertSent: vi.fn(),
    insertShare: vi.fn(),
    nextSortOrder: vi.fn(async () => "a0"),
    findListItem: vi.fn(),
  },
}));
vi.mock("../db/contact.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: { exists: vi.fn(async () => true), findContactUser: vi.fn() },
}));
vi.mock("../db/category-collaborator.repo", () => ({ default: { add: vi.fn() } }));
vi.mock("../db/reach.repo", () => ({ default: { read: vi.fn(async () => ({})) } }));
vi.mock("./task-users", () => ({
  requireTask: vi.fn(),
  requireList: vi.fn(),
  audienceOf: vi.fn(async () => ["alice"]),
  markTaskEdited: vi.fn(),
}));
vi.mock("./reach", () => ({ sendReachChanges: vi.fn() }));
vi.mock("../notify", () => ({
  sendNotification: vi.fn(async () => {}),
  getUserName: vi.fn(async () => "Alice"),
}));
vi.mock("../broadcast", () => ({ broadcast: vi.fn(), broadcastAll: vi.fn() }));

const at = "2026-10-28T09:00:00.000Z";
const bob = { id: "bob", name: "Bob", username: "bob", avatarUrl: null };
const task = { id: "t1", userId: "alice", parentId: null, title: "Buy milk" };
const share = {
  id: "s1",
  taskId: "t1",
  sharedWithUserId: "bob",
  categoryId: null,
  permission: "edit" as const,
  createdAt: at,
  updatedAt: at,
};

const post = (app: typeof taskRoutes | typeof categoryRoutes, path: string, body: object) =>
  app.request(path, {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const shareWith = (username: string) => post(taskRoutes, "/share", { taskId: "t1", username });
const addToList = (username: string) => post(categoryRoutes, "/home/collaborators", { username });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireTask).mockResolvedValue({ task, access: [], mine: {}, audience: [] } as never);
  vi.mocked(requireList).mockResolvedValue({ id: "home", name: "Home" } as never);
});

describe("sharing a task", () => {
  test("with someone who isn't a contact, or a username no one has, is refused plainly", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(null);
    const res = await shareWith("mallory");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Only your contacts can be added.");
    expect(taskRepo.insertShare).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("with a contact shares it and tells them once", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(bob);
    vi.mocked(taskRepo.insertShare).mockResolvedValueOnce({ share, added: true, changed: true });
    const res = await shareWith("Bob");
    expect(res.status).toBe(200);
    expect(contactRepo.findContactUser).toHaveBeenCalledWith("alice", "bob");
    expect(sendReachChanges).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledWith(
      "bob",
      expect.objectContaining({ type: "task-shared" }),
    );
  });

  test("with someone it's already shared with changes nothing and tells no one", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(bob);
    vi.mocked(taskRepo.insertShare).mockResolvedValueOnce({ share, added: false, changed: false });
    const res = await shareWith("bob");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(share);
    expect(sendReachChanges).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("again with another permission changes it, and tells no one it's new", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(bob);
    const upgraded = { ...share, permission: "edit" as const };
    vi.mocked(taskRepo.insertShare).mockResolvedValueOnce({
      share: upgraded,
      added: false,
      changed: true,
    });
    const res = await shareWith("bob");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(upgraded);
    expect(sendReachChanges).toHaveBeenCalledOnce();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("adding someone to a list", () => {
  test("who isn't a contact is refused plainly", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(null);
    const res = await addToList("mallory");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Only your contacts can be added.");
    expect(categoryCollaboratorRepo.add).not.toHaveBeenCalled();
  });

  test("who's already in it tells no one again", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(bob);
    vi.mocked(categoryCollaboratorRepo.add).mockResolvedValueOnce(null);
    const res = await addToList("bob");
    expect(res.status).toBe(200);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("who's a contact adds them and tells them", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValueOnce(bob);
    vi.mocked(categoryCollaboratorRepo.add).mockResolvedValueOnce({
      id: "cc1",
      categoryId: "home",
      userId: "bob",
      addedAt: at,
    });
    const res = await addToList("bob");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(bob);
    expect(sendNotification).toHaveBeenCalledWith(
      "bob",
      expect.objectContaining({ type: "category-shared" }),
    );
  });
});

describe("who sent a task", () => {
  const draft = { id: "t2", title: "Call the plumber", createdAt: at, updatedAt: at };

  test("is the signed-in sender, whatever the client says", async () => {
    const sent = { ...draft, userId: "bob", sentById: "alice" };
    vi.mocked(taskRepo.insertSent).mockResolvedValueOnce(sent as never);
    vi.mocked(taskRepo.findListItem).mockResolvedValueOnce({
      ...sent,
      sentBy: { id: "alice", name: "Alice" },
    } as never);
    const res = await post(taskRoutes, "/send", {
      ...draft,
      recipientId: "bob",
      sentById: "carol",
    });
    expect(res.status).toBe(200);
    expect(taskRepo.insertSent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "bob", sentById: "alice" }),
    );
  });

  test("reaches the recipient with the sender's name on it", async () => {
    const listed = {
      ...draft,
      userId: "bob",
      sentById: "alice",
      sentBy: { id: "alice", name: "Alice" },
    };
    vi.mocked(taskRepo.insertSent).mockResolvedValueOnce(listed as never);
    vi.mocked(taskRepo.findListItem).mockResolvedValueOnce(listed as never);
    await post(taskRoutes, "/send", { ...draft, recipientId: "bob" });
    expect(broadcast).toHaveBeenCalledWith(expect.anything(), "tasks", "insert", listed, ["bob"]);
  });

  test("is never set by adding a task of one's own", async () => {
    vi.mocked(taskRepo.insert).mockResolvedValueOnce({ ...draft, userId: "alice" } as never);
    const res = await post(taskRoutes, "/", { ...draft, userId: "", sentById: "bob" });
    expect(res.status).toBe(200);
    expect(vi.mocked(taskRepo.insert).mock.calls[0]![0]).not.toHaveProperty("sentById");
  });
});

// Last: the limit counts every call above for the same user
describe("sharing too much at once", () => {
  test("is refused until a few minutes have passed", async () => {
    vi.mocked(contactRepo.findContactUser).mockResolvedValue(bob);
    vi.mocked(taskRepo.insertShare).mockResolvedValue({ share, added: false, changed: false });
    const statuses = [];
    for (let i = 0; i < 30; i++) statuses.push((await shareWith("bob")).status);
    expect(statuses.at(-1)).toBe(429);
    expect(await (await shareWith("bob")).text()).toBe(
      "That's a lot of sharing at once. Try again in a few minutes.",
    );
  });
});
