import { ext, getStoredSession } from "~/lib/ext";
import { createPrewarm } from "~/lib/sync/prewarm";

export const prewarmSnapshot = createPrewarm(getStoredSession);

const ALARM = "prewarm";
const PREWARM_EVERY_MINUTES = 5;

/**
 * Covers what push and the stream miss: a push service that dropped the subscription, a stream
 * that died quietly. Call it at the top level: Chrome only wakes a stopped worker for listeners
 * added there.
 */
export const prewarmPeriodically = () => {
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void prewarmSnapshot();
  });
  // Creating it again restarts the countdown, and Chrome restarts its worker after seconds idle
  ext.alarms
    .get(ALARM)
    .then((alarm) => {
      if (!alarm) return ext.alarms.create(ALARM, { periodInMinutes: PREWARM_EVERY_MINUTES });
    })
    .catch(console.error);
};
