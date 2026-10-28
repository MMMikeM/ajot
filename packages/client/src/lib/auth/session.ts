import { getSignedIn, setSignedIn, type CurrentUser, type SignedIn } from "~/lib/auth/signed-in";
import { getBuildTarget } from "~/lib/build-target";
import { ext } from "~/lib/ext";
import { clearSavedLists } from "~/lib/snapshot-store";
import { MSG_TOKEN_CHANGED, TOKEN_KEY, USER_ID_KEY } from "@newtab-todo/shared/constants";

// The extension's backgrounds can't read localStorage, so they get a copy, in one write: Chrome's
// prewarms on the change and would otherwise read the new token with the last account's id
const writeForBackground = ({ token, user }: SignedIn) =>
  token
    ? ext.storage.local.set({ [TOKEN_KEY]: token, ...(user && { [USER_ID_KEY]: user.id }) })
    : ext.storage.local.remove([TOKEN_KEY, USER_ID_KEY]);

const setSession = (next: SignedIn) => {
  setSignedIn(next);
  if (getBuildTarget() !== "extension") return;
  writeForBackground(next)
    .then(() => ext.runtime.sendMessage({ type: MSG_TOKEN_CHANGED }).catch(() => {}))
    .catch(console.error);
};

/** Installs signed in before the backgrounds needed the account */
export const shareSessionWithBackground = () => {
  const session = getSignedIn();
  if (getBuildTarget() === "extension" && session.token)
    writeForBackground(session).catch(console.error);
};

export const signIn = (token: string, user: CurrentUser) => setSession({ token, user });

/**
 * Signs out on this device. Edits still queued wait, out of sight, for the account to sign back
 * in (lib/db/offline.ts).
 */
export const clearSession = () => {
  setSession({ token: null, user: null });
  clearSavedLists().catch(console.error);
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
