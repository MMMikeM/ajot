import { hc } from "hono/client";
import type { AppType } from "@newtab-todo/server/app";

export type Fetcher = typeof fetch;

/** Where a context reaches the server, and as whom. serverUrl is "" for the PWA's own origin. */
export type ApiSession = { serverUrl: string; token?: string };

/** What a context with no page of its own is handed: a background, the worker, the upload queue. */
export type SignedInSession = ApiSession & { token: string; userId: string | null };

type Options = {
  fetch?: Fetcher;
  /** Read for every request, for a page whose session changes under it; else the session's token. */
  headers?: () => Record<string, string>;
};

/**
 * The server's routes, typed from the server itself, so a path or body it doesn't take fails to
 * compile. Holds no page state, so the extension backgrounds and the PWA's worker use it too, with
 * the session they were handed; a page uses `client` from lib/api.ts, built on this.
 */
export const apiClient = ({ serverUrl, token }: ApiSession, options: Options = {}) =>
  hc<AppType>(serverUrl, {
    fetch: options.fetch ?? fetch,
    headers: options.headers ?? (token ? { Authorization: `Bearer ${token}` } : {}),
  });

export type ApiClient = ReturnType<typeof apiClient>;

export type Reply = { ok: boolean; status: number; json(): Promise<unknown> };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    what = "The server",
  ) {
    super(`${what} answered ${status}`);
  }
}

/** The response, narrowed to the route's success types; any other answer throws `ApiError`. */
export const succeeded = async <R extends Reply>(request: Promise<R>) => {
  const res = await request;
  if (!res.ok) throw new ApiError(res.status);
  return res as Extract<R, { ok: true }>;
};

/** The message a refusal carries for a person, when its body has one. */
export const errorOf = async (res: Reply) => {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
};
