import { setAuthToken } from "~/lib/auth/token";
import { clearCurrentUser } from "~/lib/auth/current-user";
import { getBuildTarget } from "~/lib/build-target";
import { ext } from "~/lib/ext";
import { TOKEN_KEY, MSG_TOKEN_CHANGED } from "~/lib/constants";

/** Signs out on this device. Queued offline edits stay in the outbox until the next sign-in. */
export const clearSession = () => {
  setAuthToken(null);
  clearCurrentUser();
  if (getBuildTarget() === "extension") {
    ext.storage.local
      .remove(TOKEN_KEY)
      .then(() => ext.runtime.sendMessage({ type: MSG_TOKEN_CHANGED }).catch(() => {}))
      .catch(console.error);
  }
};

const expiredListeners = new Set<() => void>();

export const onSessionExpired = (listener: () => void) => {
  expiredListeners.add(listener);
  return () => {
    expiredListeners.delete(listener);
  };
};

/** The server rejected the token: sign out so the header offers "Sign in". */
export const expireSession = () => {
  clearSession();
  expiredListeners.forEach((listener) => listener());
};
