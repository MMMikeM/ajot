import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as inviteTokenRepo from "./db/invite-token.repo";
import * as userRepo from "./db/user.repo";
import { login, signup } from "./auth-service";
import { hashPassword, verifyPassword } from "./password";

vi.mock("./db/user.repo", () => ({
  exists: vi.fn(),
  count: vi.fn(),
  findWithPassword: vi.fn(),
  insert: vi.fn(),
}));
vi.mock("./db/invite-token.repo", () => ({
  claim: vi.fn(),
  release: vi.fn(),
  consume: vi.fn(),
}));
vi.mock("./db/session.repo", () => ({ insert: vi.fn(async () => "token") }));
vi.mock("./db/category.repo", () => ({ insert: vi.fn() }));
vi.mock("./password", () => ({
  hashPassword: vi.fn(async () => "a hash"),
  verifyPassword: vi.fn(async () => false),
}));

const invite = {
  id: "invite",
  createdByUserId: "alice",
  expiresAt: "2099-01-01T00:00:00.000Z",
  usedAt: "now",
  usedByUserId: null,
  createdAt: "now",
};

const hashesBeforeAnyLogin = vi.mocked(hashPassword).mock.calls.length;

beforeEach(() => vi.clearAllMocks());

describe("signing up without an invite that works", () => {
  test.each([
    ["taken", true],
    ["free", false],
  ])("answers the same for a %s username", async (_, taken) => {
    vi.mocked(userRepo.exists).mockResolvedValue(taken);
    vi.mocked(userRepo.count).mockResolvedValue(3);
    vi.mocked(inviteTokenRepo.claim).mockResolvedValue(undefined);

    await expect(signup("bob", "long enough", "Bob", "dead-invite")).rejects.toMatchObject({
      status: 403,
    });
    await expect(signup("bob", "long enough", "Bob")).rejects.toMatchObject({ status: 403 });
    expect(userRepo.exists).not.toHaveBeenCalled();
  });
});

test("a taken username with an invite that works says so, and frees the invite", async () => {
  vi.mocked(inviteTokenRepo.claim).mockResolvedValue(invite);
  vi.mocked(userRepo.exists).mockResolvedValue(true);

  await expect(signup("Bob", "long enough", "Bob", "invite")).rejects.toMatchObject({
    status: 409,
  });
  expect(userRepo.exists).toHaveBeenCalledWith("bob");
  expect(inviteTokenRepo.release).toHaveBeenCalledWith("invite");
  expect(userRepo.insert).not.toHaveBeenCalled();
});

test("a username no one has is checked against a password as one that exists is", async () => {
  vi.mocked(userRepo.findWithPassword).mockResolvedValue(undefined);
  await expect(login("nobody", "guess")).rejects.toMatchObject({ status: 401 });
  await expect(login("nobody", "guess again")).rejects.toMatchObject({ status: 401 });
  expect(verifyPassword).toHaveBeenCalledTimes(2);
  expect(verifyPassword).toHaveBeenCalledWith("a hash", "guess");

  vi.mocked(userRepo.findWithPassword).mockResolvedValue({
    id: "alice",
    name: "Alice",
    username: "alice",
    passwordHash: "alice's hash",
    avatarUrl: null,
    createdAt: "now",
    updatedAt: "now",
  });
  await expect(login("alice", "guess")).rejects.toMatchObject({ status: 401 });
  expect(verifyPassword).toHaveBeenLastCalledWith("alice's hash", "guess");
});

test("the hash an unknown username is checked against is worked out at startup", async () => {
  expect(hashesBeforeAnyLogin).toBe(1);
  vi.mocked(userRepo.findWithPassword).mockResolvedValue(undefined);
  await expect(login("nobody", "guess")).rejects.toMatchObject({ status: 401 });
  expect(hashPassword).not.toHaveBeenCalled();
});
