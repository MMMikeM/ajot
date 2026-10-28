import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import sessionRepo from "./session.repo";

const findFirst = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({
  db: {
    query: { sessions: { findFirst } },
    delete: () => ({ where: async () => undefined }),
  },
}));

// The row holds the token's hash, never the token
const sessionFor = (token: string, userId: string, expiresInMs = 3_600_000) => ({
  id: `hash of ${token}`,
  userId,
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  createdAt: new Date().toISOString(),
});

// The cache outlives each test, so each one uses its own tokens
let n = 0;
const newToken = () => `token-${++n}`;

beforeEach(() => {
  vi.useFakeTimers();
  findFirst.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("findValid", () => {
  test("a session found is reused without asking the database again", async () => {
    const token = newToken();
    findFirst.mockResolvedValue(sessionFor(token, "me"));
    await sessionRepo.findValid(token);
    expect((await sessionRepo.findValid(token))?.userId).toBe("me");
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  test("it's asked again once the cached answer is 30 s old", async () => {
    const token = newToken();
    findFirst.mockResolvedValue(sessionFor(token, "me"));
    await sessionRepo.findValid(token);
    vi.advanceTimersByTime(30_000);
    await sessionRepo.findValid(token);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  test("a session that expires while cached stops passing at once", async () => {
    const token = newToken();
    findFirst.mockResolvedValueOnce(sessionFor(token, "me", 5_000));
    expect(await sessionRepo.findValid(token)).toBeDefined();
    vi.advanceTimersByTime(5_001);
    findFirst.mockResolvedValueOnce(undefined);
    expect(await sessionRepo.findValid(token)).toBeUndefined();
  });

  test("an unknown token is asked about every time", async () => {
    const token = newToken();
    findFirst.mockResolvedValue(undefined);
    await sessionRepo.findValid(token);
    await sessionRepo.findValid(token);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("signing out", () => {
  test("everywhere drops every cached session of that user, and only theirs", async () => {
    const [mine, myOther, theirs] = [newToken(), newToken(), newToken()];
    for (const [token, userId] of [
      [mine, "me"],
      [myOther, "me"],
      [theirs, "them"],
    ] as const) {
      findFirst.mockResolvedValueOnce(sessionFor(token, userId));
      await sessionRepo.findValid(token);
    }

    sessionRepo.forgetUser("me");
    findFirst.mockResolvedValue(undefined);
    expect(await sessionRepo.findValid(mine)).toBeUndefined();
    expect(await sessionRepo.findValid(myOther)).toBeUndefined();
    expect((await sessionRepo.findValid(theirs))?.userId).toBe("them");
  });

  test("a lookup that read the session before the delete isn't cached after it", async () => {
    const token = newToken();
    let answer!: (session: unknown) => void;
    findFirst.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const lookup = sessionRepo.findValid(token);

    sessionRepo.forgetUser("me");
    answer(sessionFor(token, "me"));
    await lookup;

    findFirst.mockResolvedValueOnce(undefined);
    expect(await sessionRepo.findValid(token)).toBeUndefined();
  });

  test("in another process stops the user's cached sessions passing once this one is told", async () => {
    const [mine, theirs] = [newToken(), newToken()];
    findFirst.mockResolvedValueOnce(sessionFor(mine, "me"));
    findFirst.mockResolvedValueOnce(sessionFor(theirs, "them"));
    await sessionRepo.findValid(mine);
    await sessionRepo.findValid(theirs);

    sessionRepo.forgetUser("me");
    findFirst.mockResolvedValue(undefined);
    expect(await sessionRepo.findValid(mine)).toBeUndefined();
    expect((await sessionRepo.findValid(theirs))?.userId).toBe("them");
  });

  test("one session drops just that token", async () => {
    const [token, other] = [newToken(), newToken()];
    findFirst.mockResolvedValueOnce(sessionFor(token, "me"));
    findFirst.mockResolvedValueOnce(sessionFor(other, "me"));
    await sessionRepo.findValid(token);
    await sessionRepo.findValid(other);

    await sessionRepo.remove(token);
    findFirst.mockResolvedValue(undefined);
    expect(await sessionRepo.findValid(token)).toBeUndefined();
    expect(await sessionRepo.findValid(other)).toBeDefined();
  });
});
