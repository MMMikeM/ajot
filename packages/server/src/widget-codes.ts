import { createHash } from "node:crypto";

// Long enough for a tap from the widget to open the app and sign in first
const APPROVAL_MS = 10 * 60_000;

type Approval = { userId: string; sessionId: string; expiresAt: number };

// Held in memory, as the server is one machine: a restart drops one in flight, and the widget's
// next tap makes another. Keyed by hash, as tokens are.
const approvals = new Map<string, Approval>();

const hash = (code: string) => createHash("sha256").update(code).digest("base64url");

const dropExpired = () => {
  const at = Date.now();
  for (const [key, approval] of approvals) if (approval.expiresAt <= at) approvals.delete(key);
};

/**
 * The widget's sign-in, as TV apps sign in: the phone makes a code, the app signed in on it
 * approves the code with its session, and the widget claims a token of its own with it.
 */
export const approve = (code: string, userId: string, sessionId: string) => {
  dropExpired();
  // One waiting per sign-in, so no one can fill the server's memory with codes
  for (const [key, approval] of approvals)
    if (approval.sessionId === sessionId) approvals.delete(key);
  approvals.set(hash(code), { userId, sessionId, expiresAt: Date.now() + APPROVAL_MS });
};

/** Once only, unless `putBack` returns it after a claim that failed. */
export const take = (code: string) => {
  dropExpired();
  const key = hash(code);
  const approval = approvals.get(key);
  approvals.delete(key);
  return approval;
};

export const putBack = (code: string, approval: Approval) => {
  if (approval.expiresAt > Date.now()) approvals.set(hash(code), approval);
};
