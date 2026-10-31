import { ApiError, apiClient, succeeded, type SignedInSession } from "~/lib/api-client";
import { ext } from "~/lib/ext";

// Counts wait in storage until the server takes them: a click offline, signed out or with an
// expired token is the one most worth counting, and the server can't hear about it at the time
const PENDING_KEY = "ajot-pending-metrics";
const MAX_PENDING = 200;

const readPending = async () =>
  ((await ext.storage.local.get(PENDING_KEY)) as Record<string, string[] | undefined>)[
    PENDING_KEY
  ] ?? [];

const writePending = (names: string[]) => ext.storage.local.set({ [PENDING_KEY]: names });

// One read and write of the list at a time, so two clicks can't each drop the other's count
let queue = Promise.resolve();
const serially = (work: () => Promise<void>) =>
  (queue = queue.then(work).catch((err) => console.error("[metrics]", err)));

/** Sends what's waiting, in order, until the server can't be reached. Never rejects. */
export const sendPendingMetrics = (session: SignedInSession | null) =>
  serially(async () => {
    if (!session) return;
    const { api } = apiClient(session);
    const pending = await readPending();
    let sent = 0;
    for (const name of pending) {
      try {
        await succeeded(api.metrics.$post({ json: { name } }));
      } catch (err) {
        // A name the server refuses would hold up every count behind it
        if (!(err instanceof ApiError && err.status === 400)) break;
      }
      sent++;
    }
    if (sent > 0) await writePending(pending.slice(sent));
  });

/** Counts one `name`, sent now when `session` can reach the server, or later. Never rejects. */
export const recordMetric = async (name: string, session: SignedInSession | null) => {
  await serially(async () => writePending([...(await readPending()), name].slice(-MAX_PENDING)));
  await sendPendingMetrics(session);
};
