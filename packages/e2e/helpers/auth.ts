import type { Page } from "@playwright/test";
import { BASE_URL } from "./stack";
import type { TestUser } from "./users";

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

const login = (user: TestUser) =>
  fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });

/**
 * Logs in, or signs the account up on its first run. A server that already has accounts only
 * takes a signup through an invite, which `inviter` creates.
 */
export const getOrCreateUser = async (
  user: TestUser,
  inviter?: AuthResult,
): Promise<AuthResult> => {
  const loginRes = await login(user);
  if (loginRes.ok) return loginRes.json() as Promise<AuthResult>;

  let signupRes = await signup(user);
  if (signupRes.status === 403 && inviter)
    signupRes = await signup(user, await createInvite(inviter));
  if (!signupRes.ok) {
    throw new Error(
      `Signup failed for ${user.username}: ${signupRes.status} ${await signupRes.text()}`,
    );
  }
  return signupRes.json() as Promise<AuthResult>;
};

/** Takes effect on the next load: reload or navigate after calling it. */
export const signIn = async (page: Page, auth: AuthResult): Promise<void> => {
  await page.evaluate(({ userId, token, name, username }) => {
    localStorage.setItem("newtab-todo-token", token);
    localStorage.setItem("newtab-todo-user-id", userId);
    localStorage.setItem("newtab-todo-user-info", JSON.stringify({ id: userId, name, username }));
  }, auth);
};
