import { purgeExpired } from "./db/purge.repo";
import * as sessionRepo from "./db/session.repo";

const DAY_MS = 24 * 3_600_000;
// Timers stop while Fly has the machine suspended, and it may be awake only minutes at a time,
// so a short timer checks the wall clock rather than one waiting a day
const CHECK_MS = 60_000;

let lastPurgedAt = 0;
let purging = false;

const purgeIfDue = async () => {
  if (purging || Date.now() - lastPurgedAt < DAY_MS) return;
  purging = true;
  try {
    const purged = await purgeExpired();
    lastPurgedAt = Date.now();
    const hashedSessions = await hashStoredTokens();
    console.log("[purge]", JSON.stringify({ ...purged, hashedSessions }));
  } catch (err) {
    console.error("[purge] failed; trying again in a minute:", err);
  } finally {
    purging = false;
  }
};

// A token stored as itself still signs in and is hashed once used, so one left over waits for
// tomorrow's purge rather than rerunning today's
const hashStoredTokens = async () => {
  try {
    return await sessionRepo.hashStoredTokens();
  } catch (err) {
    console.error("[purge] couldn't hash stored session tokens; trying again tomorrow:", err);
    return "failed";
  }
};

export const startPurging = () => {
  void purgeIfDue();
  setInterval(() => void purgeIfDue(), CHECK_MS).unref();
};
