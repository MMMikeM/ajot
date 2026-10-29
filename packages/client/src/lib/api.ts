import { apiClient } from "~/lib/api-client";
import { getAuthToken } from "~/lib/auth/token";
import { expireSession } from "~/lib/auth/session";
import { clientId } from "~/lib/client-id";
import { getOrCreateDeviceId } from "~/lib/auth/current-user";
import { getBuildTarget } from "~/lib/build-target";
import { getServerUrl } from "~/lib/server-url";
import { markStartup } from "~/lib/startup-timing";

// During SSR prerender (Node.js), relative URLs are invalid and there's no auth
const ssrFetch = () =>
  Promise.resolve(new Response("[]", { headers: { "content-type": "application/json" } }));

export const apiHeaders = (): Record<string, string> => {
  const token = getAuthToken();
  return {
    ...(token && { Authorization: `Bearer ${token}` }),
    "X-Client-Id": clientId,
    // Only the PWA has web push subscriptions to skip. Same origin, so a server too old to allow
    // the header in CORS never sees a preflight for it.
    ...(getBuildTarget() === "browser" && { "X-Device-Id": getOrCreateDeviceId() }),
  };
};

const answeredPaths = new Set<string>();

const markFirstResponse = (url: string) => {
  const path = new URL(url, location.href).pathname;
  if (answeredPaths.has(path)) return;
  answeredPaths.add(path);
  markStartup(`server ${path}`);
};

// What signing can't do: the server the extension sends to can change under the page, and a 401
// ends the session
const browserFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = getAuthToken();
  // Routes are relative; the extension sends them to the server the user chose
  const url = typeof input === "string" && input.startsWith("/") ? getServerUrl() + input : input;
  const res = await fetch(url, init);
  if (typeof url === "string") markFirstResponse(url);
  // Skip if the user signed in again while this request was in flight
  if (res.status === 401 && token && token === getAuthToken()) expireSession();
  return res;
};

export const client = apiClient(
  { serverUrl: "" },
  { fetch: typeof window === "undefined" ? ssrFetch : browserFetch, headers: apiHeaders },
);
