import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import contactRepo from "../db/contact.repo";
import inviteTokenRepo from "../db/invite-token.repo";
import { broadcastPerUser } from "../broadcast";
import { contactRoutes } from "./contacts";
import { inviteRoutes } from "./invites";

vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("../db/contact.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  default: { remove: vi.fn(), restore: vi.fn(), listByIds: vi.fn() },
}));
vi.mock("../db/invite-token.repo", () => ({ default: { findValid: vi.fn(), consume: vi.fn() } }));
vi.mock("../notify", () => ({ sendNotification: vi.fn(async () => {}) }));
vi.mock("./reach", () => ({ sendReachChanges: vi.fn() }));
vi.mock("../broadcast", () => ({ broadcastPerUser: vi.fn() }));

const alicesRow = { id: "alices-row", userId: "alice", contactUserId: "bob", createdAt: "then" };
const bobsRow = { id: "bobs-row", userId: "bob", contactUserId: "alice", createdAt: "then" };
const withUser = (row: typeof alicesRow, name: string) => ({
  ...row,
  contactUser: { id: row.contactUserId, name, username: name.toLowerCase(), avatarUrl: null },
});
const listed = [withUser(alicesRow, "Bob"), withUser(bobsRow, "Alice")];
const noReach = { taskIds: [], listIds: [], tasks: new Map(), lists: new Map() };
const authed = { headers: { authorization: "Bearer token" } };

const sent = () => vi.mocked(broadcastPerUser).mock.calls.flatMap(([, addressed]) => addressed);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contactRepo.listByIds).mockImplementation(async (ids) =>
    listed.filter((row) => ids.includes(row.id)),
  );
});

describe("a change to who's a contact reaches both people live", () => {
  test("removing one takes each person's own row off their page", async () => {
    vi.mocked(contactRepo.remove).mockResolvedValueOnce({
      contact: alicesRow,
      removed: [alicesRow, bobsRow],
      before: noReach,
      changed: [],
    });
    const res = await contactRoutes.request("/alices-row", { method: "DELETE", ...authed });
    expect(res.status).toBe(200);
    expect(sent()).toEqual([
      {
        userId: "alice",
        event: { model: "contacts", action: "delete", data: { id: "alices-row" } },
      },
      { userId: "bob", event: { model: "contacts", action: "delete", data: { id: "bobs-row" } } },
    ]);
  });

  test("undoing it puts each person's own row back, with who it is", async () => {
    vi.mocked(contactRepo.restore).mockResolvedValueOnce({
      contact: alicesRow,
      restored: [alicesRow, bobsRow],
      before: noReach,
      changed: [],
    });
    const res = await contactRoutes.request("/alices-row/restore", { method: "POST", ...authed });
    expect(res.status).toBe(200);
    expect(sent()).toEqual([
      { userId: "alice", event: { model: "contacts", action: "insert", data: listed[0] } },
      { userId: "bob", event: { model: "contacts", action: "insert", data: listed[1] } },
    ]);
  });

  test("an Undo replayed after it already landed sends nothing", async () => {
    vi.mocked(contactRepo.restore).mockResolvedValueOnce({
      contact: alicesRow,
      restored: [],
      before: noReach,
      changed: [],
    });
    const res = await contactRoutes.request("/alices-row/restore", { method: "POST", ...authed });
    expect(res.status).toBe(200);
    expect(sent()).toEqual([]);
  });

  test("accepting an invite sends each person their new row", async () => {
    vi.mocked(inviteTokenRepo.findValid).mockResolvedValueOnce({
      id: "invite",
      createdByUserId: "bob",
      expiresAt: "later",
      usedAt: null,
      usedByUserId: null,
      createdAt: "then",
    });
    vi.mocked(inviteTokenRepo.consume).mockResolvedValueOnce([alicesRow, bobsRow]);
    const res = await inviteRoutes.request("/invite/accept", { method: "POST", ...authed });
    expect(res.status).toBe(200);
    expect(sent().map(({ userId, event }) => [userId, event.action, event.data])).toEqual([
      ["alice", "insert", listed[0]],
      ["bob", "insert", listed[1]],
    ]);
  });
});
