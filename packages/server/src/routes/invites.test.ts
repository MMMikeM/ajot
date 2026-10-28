import { beforeEach, expect, test, vi } from "vite-plus/test";
import inviteTokenRepo from "../db/invite-token.repo";
import { inviteRoutes } from "./invites";

vi.mock("../auth", () => ({
  extractToken: () => "token",
  validateSession: async () => "alice",
}));
vi.mock("../db/client", () => ({ db: {}, inTransaction: vi.fn() }));
vi.mock("../db/invite-token.repo", () => ({
  default: { claim: vi.fn(), release: vi.fn(), consume: vi.fn() },
}));
vi.mock("../notify", () => ({ sendNotification: vi.fn(), getUserName: vi.fn(async () => "A") }));
vi.mock("./contact-changes", () => ({ sendContactChanges: vi.fn() }));

const invite = (createdByUserId: string) => ({
  id: "invite",
  createdByUserId,
  expiresAt: "later",
  usedAt: "now",
  usedByUserId: null,
  createdAt: "then",
});
const accept = () =>
  inviteRoutes.request("/invite/accept", {
    method: "POST",
    headers: { authorization: "Bearer token" },
  });

beforeEach(() => vi.clearAllMocks());

test("an invite someone else claimed first is gone", async () => {
  vi.mocked(inviteTokenRepo.claim).mockResolvedValueOnce(undefined);
  expect((await accept()).status).toBe(410);
  expect(inviteTokenRepo.consume).not.toHaveBeenCalled();
});

test("accepting your own invite leaves it for someone else", async () => {
  vi.mocked(inviteTokenRepo.claim).mockResolvedValueOnce(invite("alice"));
  expect((await accept()).status).toBe(400);
  expect(inviteTokenRepo.release).toHaveBeenCalledWith("invite");
  expect(inviteTokenRepo.consume).not.toHaveBeenCalled();
});

test("an accept that fails leaves the invite to try again", async () => {
  vi.mocked(inviteTokenRepo.claim).mockResolvedValueOnce(invite("bob"));
  vi.mocked(inviteTokenRepo.consume).mockRejectedValueOnce(new Error("lost the connection"));
  expect((await accept()).status).toBe(500);
  expect(inviteTokenRepo.release).toHaveBeenCalledWith("invite");
});

test("an accept claims the invite, and only once", async () => {
  vi.mocked(inviteTokenRepo.claim).mockResolvedValueOnce(invite("bob"));
  vi.mocked(inviteTokenRepo.consume).mockResolvedValueOnce([]);
  expect((await accept()).status).toBe(200);
  expect(inviteTokenRepo.claim).toHaveBeenCalledWith("invite");
  expect(inviteTokenRepo.release).not.toHaveBeenCalled();
});
