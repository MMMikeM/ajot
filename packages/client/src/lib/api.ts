import type { AppType } from "@newtab-todo/server/app";
import { hc } from "hono/client";
import { getAuthToken } from "~/lib/auth/token";
import { expireSession } from "~/lib/auth/session";
import { clientId } from "~/lib/client-id";
import { getServerUrl } from "~/lib/server-url";

// During SSR prerender (Node.js), relative URLs are invalid and there's no auth.
// Return empty JSON so collections render with no data — client hydrates after mount.
const ssrFetch = () =>
  Promise.resolve(new Response("[]", { headers: { "content-type": "application/json" } }));

export const apiHeaders = (): Record<string, string> => {
  const token = getAuthToken();
  return { ...(token && { Authorization: `Bearer ${token}` }), "X-Client-Id": clientId };
};

const browserFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(apiHeaders())) headers.set(name, value);
  // Routes are relative; the extension sends them to the server the user chose
  const url = typeof input === "string" && input.startsWith("/") ? getServerUrl() + input : input;
  const res = await fetch(url, { ...init, headers });
  // Skip if the user signed in again while this request was in flight
  if (res.status === 401 && token && token === getAuthToken()) expireSession();
  return res;
};

export const client = hc<AppType>("", {
  fetch: typeof window === "undefined" ? ssrFetch : browserFetch,
});
