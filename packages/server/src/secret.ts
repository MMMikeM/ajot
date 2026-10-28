import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether a request's secret is the configured one, taking as long however much of it matches.
 * Compared as digests, which are always the same length, as timingSafeEqual needs.
 */
export const isSecret = (given: string | undefined, secret: string | undefined) =>
  !!given && !!secret && timingSafeEqual(digest(given), digest(secret));
