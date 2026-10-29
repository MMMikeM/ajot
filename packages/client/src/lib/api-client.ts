import { hc } from "hono/client";
import type { AppType } from "@newtab-todo/server/app";

export type Fetcher = typeof fetch;

/** Where a context reaches the server, and as whom. serverUrl is "" for the PWA's own origin. */
export type ApiSession = { serverUrl: string; token?: string | null };

/**
 * The server's routes, typed from the server itself, so a path or body it doesn't take fails to
 * compile. Holds no page state, so the extension backgrounds and the PWA's worker use it too, with
 * the session they were handed; a page uses `client` from lib/api.ts, built on this.
 */
export const apiClient = ({ serverUrl, token }: ApiSession, fetcher: Fetcher = fetch) =>
  hc<AppType>(serverUrl, {
    // Called unbound, a browser's fetch throws "Illegal invocation"
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetcher(input, init),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

type Reply = { ok: boolean; status: number };

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`The server answered ${status}`);
  }
}

/** The response, narrowed to the route's success types; any other answer throws `ApiError`. */
export const succeeded = async <R extends Reply>(request: Promise<R>) => {
  const res = await request;
  if (!res.ok) throw new ApiError(res.status);
  return res as Extract<R, { ok: true }>;
};
