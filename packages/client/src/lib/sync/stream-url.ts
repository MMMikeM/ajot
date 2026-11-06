import { apiClient, succeeded, type ApiClient } from "~/lib/api-client";

/**
 * Where to open the event stream as the session's user: with a ticket the stream's opening spends,
 * since an EventSource can't send the token in a header and a URL ends up in logs. Rejects when the
 * ticket can't be had, as `api` refused or couldn't reach the server.
 */
export const eventStreamUrl = async (
  session: { serverUrl: string; token: string },
  api: ApiClient = apiClient(session),
) => {
  const { ticket } = await (await succeeded(api.api.events.ticket.$post())).json();
  const url = apiClient({ serverUrl: session.serverUrl || location.origin }).api.events.$url();
  url.searchParams.set("ticket", ticket);
  return url.href;
};
