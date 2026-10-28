import { purgeExpired } from "./db/purge.repo";

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
    console.log("[purge]", JSON.stringify(purged));
  } catch (err) {
    console.error("[purge] failed; trying again in a minute:", err);
  } finally {
    purging = false;
  }
};

/**
 * Deleted tasks and lists, Undo records, sessions, invites and notifications past keeping: now,
 * then daily while awake.
 */
export const startPurging = () => {
  void purgeIfDue();
  setInterval(() => void purgeIfDue(), CHECK_MS).unref();
};
