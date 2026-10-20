import type { AppType } from "@newtab-todo/server/app";
import { hc } from "hono/client";
import { getAuthToken } from "~/lib/auth/token";
import { clientId } from "~/lib/client-id";

// In dev, API is on the same origin (Hono dev server plugin).
// In prod/extension, SERVER_URL points to the deployed server.
export const serverUrl = import.meta.env.DEV ? "" : (import.meta.env.SERVER_URL ?? "");

// During SSR prerender (Node.js), relative URLs are invalid and there's no auth.
// Return empty JSON so collections render with no data — client hydrates after mount.
const ssrFetch = () =>
  Promise.resolve(new Response("[]", { headers: { "content-type": "application/json" } }));

export const apiHeaders = (): Record<string, string> => {
  const token = getAuthToken();
  return { ...(token && { Authorization: `Bearer ${token}` }), "X-Client-Id": clientId };
};

const browserFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(apiHeaders())) headers.set(name, value);
  return fetch(input, { ...init, headers });
};

export const client = hc<AppType>(serverUrl, {
  fetch: typeof window === "undefined" ? ssrFetch : browserFetch,
});
