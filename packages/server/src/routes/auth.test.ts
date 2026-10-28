import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import inviteTokenRepo from "../db/invite-token.repo";
import { NotFoundError } from "../db/errors";
import sessionRepo from "../db/session.repo";
import { login, signup } from "../auth-service";
import { signRevocation } from "../session-revocation";
import { authRoutes } from "./auth";
import { sendContactChanges } from "./contact-changes";
import { rejectInvalidInput } from "./openapi-schemas";

vi.mock("../db/invite-token.repo", () => ({ default: { findInviterName: vi.fn() } }));
vi.mock("../db/session.repo", () => ({ default: { forgetUser: vi.fn() } }));
vi.mock("../auth-service", () => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock("../auth", () => ({ extractToken: vi.fn(), validateSession: vi.fn() }));
vi.mock("../notify", () => ({ sendNotification: vi.fn() }));
vi.mock("./contact-changes", () => ({ sendContactChanges: vi.fn() }));

describe("GET /invites/:token", () => {
  test("names whoever made a usable invite, without a session", async () => {
    vi.mocked(inviteTokenRepo.findInviterName).mockResolvedValueOnce("Mike Murray");
    const res = await authRoutes.request("/invites/abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inviterName: "Mike Murray" });
    expect(inviteTokenRepo.findInviterName).toHaveBeenCalledWith("abc");
  });

  test("an unknown, used or expired invite says nothing about anyone", async () => {
    vi.mocked(inviteTokenRepo.findInviterName).mockRejectedValueOnce(new NotFoundError("invite"));
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

describe("POST /signup", () => {
  test("with an invite, sends both new contact rows to their pages live", async () => {
    vi.mocked(signup).mockResolvedValueOnce({
      session: { userId: "bob", token: "t", name: "Bob", username: "bob" },
      invitedBy: "alice",
      contacts: [
        { id: "alices-row", userId: "alice", contactUserId: "bob", createdAt: "now" },
        { id: "bobs-row", userId: "bob", contactUserId: "alice", createdAt: "now" },
      ],
    });
    const res = await authRoutes.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "long enough pw", name: "Bob" }),
    });
    expect(res.status).toBe(200);
    expect(sendContactChanges).toHaveBeenCalledWith(expect.anything(), {
      addedIds: ["alices-row", "bobs-row"],
    });
  });
});

describe("too many tries", () => {
  const session = { userId: "u", token: "t", name: "N", username: "n" };
  beforeEach(() => vi.stubEnv("FLY_APP_NAME", "ajot"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(login).mockReset();
  });
  // As app.ts answers a refusal, keeping the headers set before it
  const answering = new OpenAPIHono({ defaultHook: rejectInvalidInput })
    .route("/", authRoutes)
    .onError((err, c) =>
      err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.text("", 500),
    );
  const from = (ip: string, path: string, body: unknown) =>
    answering.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Fly-Client-IP": ip },
      body: JSON.stringify(body),
    });

  test("from one address, signing in waits, without trying the password", async () => {
    vi.mocked(login).mockResolvedValue(session);
    for (let i = 0; i < 20; i++)
      expect(
        (await from("203.0.113.1", "/login", { username: `u${i}`, password: "p" })).status,
      ).toBe(200);

    const res = await from("203.0.113.1", "/login", { username: "another", password: "p" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await res.json()).toEqual({
      error: "Too many tries at signing in. Try again in 15 minutes.",
    });
    expect(login).toHaveBeenCalledTimes(20);
    expect((await from("203.0.113.2", "/login", { username: "u0", password: "p" })).status).toBe(
      200,
    );
  });

  test("at one username, wrong passwords from one address stop it being tried from there", async () => {
    vi.mocked(login).mockRejectedValue(new HTTPException(401, { message: "Wrong" }));
    for (let i = 0; i < 10; i++)
      expect(
        (await from("198.51.100.1", "/login", { username: "Target", password: `${i}` })).status,
      ).toBe(401);

    const res = await from("198.51.100.1", "/login", { username: "target", password: "right" });
    expect(res.status).toBe(429);
    expect(login).toHaveBeenCalledTimes(10);
  });

  test("at one username, wrong passwords from one address don't lock out its owner elsewhere", async () => {
    vi.mocked(login).mockRejectedValue(new HTTPException(401, { message: "Wrong" }));
    for (let i = 0; i < 15; i++)
      await from("198.51.100.66", "/login", { username: "owner", password: `${i}` });

    vi.mocked(login).mockResolvedValueOnce(session);
    const res = await from("192.0.2.80", "/login", { username: "owner", password: "right" });
    expect(res.status).toBe(200);
  });

  test("at one username, guesses sent at once are counted together", async () => {
    vi.mocked(login).mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new HTTPException(401, { message: "Wrong" })), 10),
        ),
    );
    const statuses = await Promise.all(
      Array.from({ length: 15 }, async (_, i) => {
        const res = await from("198.18.0.1", "/login", { username: "burst", password: `${i}` });
        return res.status;
      }),
    );

    expect(login).toHaveBeenCalledTimes(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  test("signing in clears the username's wrong passwords", async () => {
    vi.mocked(login).mockRejectedValue(new HTTPException(401, { message: "Wrong" }));
    for (let i = 0; i < 9; i++)
      await from("192.0.2.1", "/login", { username: "typo", password: "x" });
    vi.mocked(login).mockResolvedValueOnce(session);
    await from("192.0.2.1", "/login", { username: "typo", password: "right" });

    expect((await from("192.0.2.1", "/login", { username: "typo", password: "x" })).status).toBe(
      401,
    );
  });

  test("from one address, signing up waits", async () => {
    vi.mocked(signup).mockRejectedValue(new HTTPException(403, { message: "No invite" }));
    const body = (i: number) => ({ username: `new${i}`, password: "long enough", name: "N" });
    for (let i = 0; i < 10; i++)
      expect((await from("203.0.113.9", "/signup", body(i))).status).toBe(403);

    expect((await from("203.0.113.9", "/signup", body(10))).status).toBe(429);
    vi.mocked(signup).mockReset();
  });

  test("tries at a username from one address don't keep it from someone elsewhere", async () => {
    vi.mocked(signup).mockRejectedValue(new HTTPException(403, { message: "No invite" }));
    const wanted = { username: "wanted", password: "long enough", name: "W" };
    for (let i = 0; i < 10; i++) await from("203.0.113.20", "/signup", wanted);

    expect((await from("203.0.113.21", "/signup", wanted)).status).toBe(403);
    vi.mocked(signup).mockReset();
  });

  test("behind a proxy on the Docker bridge, one person's wrong passwords lock out no one else", async () => {
    vi.unstubAllEnvs();
    const viaProxy = (client: string, body: unknown) =>
      answering.request(
        "/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Forwarded-For": client },
          body: JSON.stringify(body),
        },
        { incoming: { socket: { remoteAddress: "172.17.0.1" } } },
      );
    vi.mocked(login).mockRejectedValue(new HTTPException(401, { message: "Wrong" }));
    for (let i = 0; i < 20; i++)
      await viaProxy("203.0.113.50", { username: `w${i}`, password: "x" });
    expect((await viaProxy("203.0.113.50", { username: "w0", password: "x" })).status).toBe(429);

    vi.mocked(login).mockResolvedValueOnce(session);
    expect((await viaProxy("203.0.113.51", { username: "w0", password: "right" })).status).toBe(
      200,
    );
  });

  test("an address someone sent is ignored off Fly, where nothing overwrites it", async () => {
    vi.unstubAllEnvs();
    vi.mocked(login).mockResolvedValue(session);
    for (let i = 0; i < 25; i++)
      expect(
        (await from("203.0.113.1", "/login", { username: `v${i}`, password: "p" })).status,
      ).toBe(200);
  });
});
