import { describe, expect, test, vi } from "vite-plus/test";
import inviteTokenRepo from "../db/invite-token.repo";
import { authRoutes } from "./auth";

vi.mock("../db/invite-token.repo", () => ({ default: { findInviterName: vi.fn() } }));
vi.mock("../db/session.repo", () => ({ default: {} }));
vi.mock("../auth-service", () => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock("../auth", () => ({ extractToken: vi.fn(), validateSession: vi.fn() }));
vi.mock("../notify", () => ({ sendNotification: vi.fn() }));

describe("GET /invites/:token", () => {
  test("names whoever made a usable invite, without a session", async () => {
    vi.mocked(inviteTokenRepo.findInviterName).mockResolvedValueOnce("Mike Murray");
    const res = await authRoutes.request("/invites/abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inviterName: "Mike Murray" });
    expect(inviteTokenRepo.findInviterName).toHaveBeenCalledWith("abc");
  });

  test("an unknown, used or expired invite says nothing about anyone", async () => {
    vi.mocked(inviteTokenRepo.findInviterName).mockResolvedValueOnce(null);
    const res = await authRoutes.request("/invites/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/Mike/);
  });
});
