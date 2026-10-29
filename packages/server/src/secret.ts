import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compared as digests, which are always the same length, as timingSafeEqual needs. */
export const isSecret = (given: string | undefined, secret: string | undefined) =>
  !!given && !!secret && timingSafeEqual(digest(given), digest(secret));
