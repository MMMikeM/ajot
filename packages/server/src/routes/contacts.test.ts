import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as contactRepo from "../db/contact.repo";
import { broadcastPerUser } from "../broadcast";
import { contactRoutes } from "./contacts";

vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("../db/contact.repo", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  remove: vi.fn(),
  listByIds: vi.fn(),
}));
vi.mock("./reach", () => ({ sendReachChanges: vi.fn() }));
vi.mock("../broadcast", () => ({ broadcastPerUser: vi.fn() }));

const alicesRow = { id: "alices-row", userId: "alice", contactUserId: "bob", createdAt: "then" };
const bobsRow = { id: "bobs-row", userId: "bob", contactUserId: "alice", createdAt: "then" };
const noReach = { taskIds: [], listIds: [], tasks: new Map(), lists: new Map() };
const authed = { headers: { authorization: "Bearer token" } };

const sent = () => vi.mocked(broadcastPerUser).mock.calls.flatMap(([, addressed]) => addressed);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(contactRepo.listByIds).mockResolvedValue([]);
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
});
