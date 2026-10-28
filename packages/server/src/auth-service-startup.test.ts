import { expect, test, vi } from "vite-plus/test";
import userRepo from "./db/user.repo";
import { login } from "./auth-service";
import { hashPassword, verifyPassword } from "./password";

vi.mock("./db/user.repo", () => ({ default: { findWithPassword: vi.fn(async () => undefined) } }));
vi.mock("./db/session.repo", () => ({ default: { insert: vi.fn() } }));
vi.mock("./db/category.repo", () => ({ default: { insert: vi.fn() } }));
vi.mock("./db/invite-token.repo", () => ({ default: {} }));
vi.mock("./password", () => ({
  hashPassword: vi
    .fn()
    .mockRejectedValueOnce(new Error("out of memory"))
    .mockResolvedValue("a hash"),
  verifyPassword: vi.fn(async () => false),
}));

const hashesAtStartup = vi.mocked(hashPassword).mock.calls.length;

test("a stand-in hash that failed at startup is worked out again, not kept failing", async () => {
  expect(hashesAtStartup).toBe(1);
  await expect(login("nobody", "guess")).rejects.toMatchObject({ status: 401 });
  await expect(login("nobody", "guess again")).rejects.toMatchObject({ status: 401 });

  expect(userRepo.findWithPassword).toHaveBeenCalledTimes(2);
  expect(hashPassword).toHaveBeenCalledTimes(1);
  expect(verifyPassword).toHaveBeenCalledWith("a hash", "guess again");
});
