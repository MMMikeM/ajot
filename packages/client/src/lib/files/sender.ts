import type { SignedInSession } from "~/lib/api-client";
import { drainUploads, type DrainDeps } from "~/lib/files/uploads";

type Options = Pick<DrainDeps, "only" | "onUploaded"> & {
  /** When the soonest retry is due, for a context that lives long enough to wait for it. */
  onRetryAt?: (at: number) => void;
};

/**
 * Sends what's waiting for whoever `getSession` says is signed in here. A call during a run makes
 * it run once more after, so a trigger is never lost and overlapping ones send once.
 */
export const createUploadSender = (
  getSession: () => SignedInSession | null | Promise<SignedInSession | null>,
  { onRetryAt, ...deps }: Options = {},
) => {
  let running = false;
  let again = false;
  return async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const session = await getSession();
        if (!session) return;
        const retryAt = await drainUploads(session, deps);
        if (retryAt !== undefined) onRetryAt?.(retryAt);
      } while (again);
    } catch (err) {
      console.error("[uploads]", err);
    } finally {
      running = false;
    }
  };
};
