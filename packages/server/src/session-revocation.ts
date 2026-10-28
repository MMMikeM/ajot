import { createHmac, timingSafeEqual } from "node:crypto";

/** Allows for the script's clock and the server's disagreeing, and a slow request. */
const FRESH_MS = 5 * 60_000;

export type Revocation = { userId: string; at: number; signature: string };

const sign = (key: string, userId: string, at: number) =>
  createHmac("sha256", key).update(`sessions-revoked:${userId}:${at}`).digest();

/**
 * Tells the running server that a user's sessions were deleted in another process. Keyed by the
 * database's token, which the script already holds: whoever has it can delete sessions anyway.
 */
export const signRevocation = (key: string, userId: string, at = Date.now()): Revocation => ({
  userId,
  at,
  signature: sign(key, userId, at).toString("hex"),
});

export const isSignedRevocation = (
  key: string | undefined,
  { userId, at, signature }: Revocation,
) => {
  if (!key || Math.abs(Date.now() - at) > FRESH_MS) return false;
  const given = Buffer.from(signature, "hex");
  const expected = sign(key, userId, at);
  return given.length === expected.length && timingSafeEqual(given, expected);
};
