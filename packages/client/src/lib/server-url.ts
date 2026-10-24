import { SERVER_URL_KEY } from "~/lib/constants";
import { getBuildTarget } from "~/lib/build-target";
import { ext } from "~/lib/ext";
import { getAuthToken } from "~/lib/auth/token";
import { clearSession } from "~/lib/auth/session";

// The PWA is served by its own server, so it calls its own origin (""). The extension has no
// server until the user enters one; until then it stays local-only.
const isExtension = getBuildTarget() === "extension";

let serverUrl = isExtension ? (localStorage.getItem(SERVER_URL_KEY) ?? "") : "";

// Installs from before the server was a setting still hold a token for the old built-in one.
// Signing out keeps their queued edits for the next sign-in instead of sending them nowhere.
if (isExtension && !serverUrl && getAuthToken()) clearSession();

export const getServerUrl = () => serverUrl;

/** The background scripts read the copy in extension storage, so it's written before resolving. */
export const setServerUrl = async (url: string) => {
  if (!isExtension) return;
  localStorage.setItem(SERVER_URL_KEY, url);
  await ext.storage.local.set({ [SERVER_URL_KEY]: url });
  serverUrl = url;
};
