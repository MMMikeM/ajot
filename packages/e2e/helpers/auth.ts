import type { Page } from "@playwright/test";
import type { TestUser } from "./users";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";

export type AuthResult = {
  userId: string;
  token: string;
  name: string;
  username: string;
};

const signup = (user: TestUser, invite?: string) =>
  fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: user.username,
      password: user.password,
      name: user.name,
      invite,
    }),
  });

const createInvite = async (inviter: AuthResult) => {
  const res = await fetch(`${BASE_URL}/api/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${inviter.token}` },
  });
  if (!res.ok) throw new Error(`Invite failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { token: string }).token;
};

/**
 * A 409 from signup means the account exists from an earlier run, so it logs in instead. A 403
 * means the server already has accounts, so a new one needs an invite from `inviter`.
 */
export const getOrCreateUser = async (
  user: TestUser,
  inviter?: AuthResult,
): Promise<AuthResult> => {
  let signupRes = await signup(user);
  if (signupRes.status === 403 && inviter)
    signupRes = await signup(user, await createInvite(inviter));

  if (signupRes.ok) return signupRes.json() as Promise<AuthResult>;
  if (signupRes.status !== 409) {
    throw new Error(
      `Signup failed for ${user.username}: ${signupRes.status} ${await signupRes.text()}`,
    );
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });

  if (!loginRes.ok) {
    throw new Error(
      `Login failed for ${user.username}: ${loginRes.status} ${await loginRes.text()}`,
    );
  }
  return loginRes.json() as Promise<AuthResult>;
};

/** Takes effect on the next load: reload or navigate after calling it. */
export const signIn = async (page: Page, auth: AuthResult): Promise<void> => {
  await page.evaluate(({ userId, token, name, username }) => {
    localStorage.setItem("newtab-todo-token", token);
    localStorage.setItem("newtab-todo-user-id", userId);
    localStorage.setItem("newtab-todo-user-info", JSON.stringify({ id: userId, name, username }));
  }, auth);
};
