import { ApiError, apiClient, succeeded, type ApiClient } from "~/lib/api-client";

/**
 * Where to open the event stream as the session's user: with a ticket the stream's opening spends,
 * since an EventSource can't send the token in a header and a URL ends up in logs. Rejects when the
 * ticket can't be had, as `api` refused or couldn't reach the server.
 */
export const eventStreamUrl = async (
  { serverUrl, token }: { serverUrl: string; token: string },
  api: ApiClient = apiClient({ serverUrl, token }),
) => {
  let query: Record<string, string>;
  try {
    const { ticket } = await (await succeeded(api.api.events.ticket.$post())).json();
    query = { ticket };
  } catch (err) {
    // A server older than tickets has no route for one, and still takes the token
    if (!(err instanceof ApiError && (err.status === 404 || err.status === 501))) throw err;
    query = { token };
  }
  const url = apiClient({ serverUrl: serverUrl || location.origin }).api.events.$url();
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.href;
};
