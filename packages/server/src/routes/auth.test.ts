import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import inviteTokenRepo from "../db/invite-token.repo";
import sessionRepo from "../db/session.repo";
import { signRevocation } from "../session-revocation";
import { authRoutes } from "./auth";
import { rejectInvalidInput } from "./openapi-schemas";

vi.mock("../db/invite-token.repo", () => ({ default: { findInviterName: vi.fn() } }));
vi.mock("../db/session.repo", () => ({ default: { forgetUser: vi.fn() } }));
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

// Mounted as app.ts mounts it, under an app whose hook every route inherits
const api = new OpenAPIHono({ defaultHook: rejectInvalidInput }).route("/", authRoutes);
const post = (path: string, body: unknown) =>
  api.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("input a route refuses", () => {
  test("answers with a message the client can show, as other refusals do", async () => {
    const res = await post("/signup", { username: "ab", password: "long enough", name: "Al" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Username must be at least 3 characters" });
  });
});

describe("POST /sessions-revoked", () => {
  const key = "the-database-token";
  beforeEach(() => vi.stubEnv("TURSO_AUTH_TOKEN", key));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(sessionRepo.forgetUser).mockClear();
  });

  test("signed with the database token, stops the server vouching for the user's sessions", async () => {
    const res = await post("/sessions-revoked", signRevocation(key, "me"));
    expect(res.status).toBe(200);
    expect(sessionRepo.forgetUser).toHaveBeenCalledWith("me");
  });

  test.each([
    ["signed with another key", signRevocation("another-key", "me")],
    ["signed for someone else", { ...signRevocation(key, "them"), userId: "me" }],
    ["signed too long ago", signRevocation(key, "me", Date.now() - 10 * 60_000)],
    ["not signed", { userId: "me", at: Date.now(), signature: "" }],
  ])("%s, is refused", async (_, revocation) => {
    const res = await post("/sessions-revoked", revocation);
    expect(res.status).toBe(401);
    expect(sessionRepo.forgetUser).not.toHaveBeenCalled();
  });

  test("is refused by a server without a database token", async () => {
    vi.stubEnv("TURSO_AUTH_TOKEN", "");
    const res = await post("/sessions-revoked", signRevocation("", "me"));
    expect(res.status).toBe(401);
    expect(sessionRepo.forgetUser).not.toHaveBeenCalled();
  });
});
