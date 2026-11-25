import { apiClient, succeeded, type ApiClient } from "~/lib/api-client";

// A stopped Fly machine takes a few seconds to answer its first request while it resumes
const TICKET_TIMEOUT_MS = 15_000;

/**
 * Where to open the event stream as the session's user: with a ticket the stream's opening spends,
 * since an EventSource can't send the token in a header and a URL ends up in logs. Rejects when the
 * ticket can't be had, as `api` refused, couldn't reach the server or didn't answer in time.
 */
export const eventStreamUrl = async (
  session: { serverUrl: string; token: string },
  api: ApiClient = apiClient(session),
) => {
  const request = api.api.events.ticket.$post(undefined, {
    init: { signal: AbortSignal.timeout(TICKET_TIMEOUT_MS) },
  });
  const { ticket } = await (await succeeded(request)).json();
  const url = apiClient({ serverUrl: session.serverUrl || location.origin }).api.events.$url();
  url.searchParams.set("ticket", ticket);
  return url.href;
};

// The server sends a heartbeat every 30 s, so two missed ones mean the connection is gone even
// though the EventSource still reads as open, as after a laptop sleeps or a network drops silently
const SILENT_FOR_MS = 75_000;
const HEARTBEAT = "heartbeat";

/**
 * Opens the stream at `url`, calling `onLost` once when it fails or falls silent, after closing it:
 * the EventSource's own retry would reopen it with the ticket its first opening spent, which the
 * server refuses, so the caller reconnects with a fresh one. `handlers` are by event name, as an
 * EventSource has no listener for every event.
 */
export const openEventStream = (
  url: string,
  handlers: Record<string, (event: MessageEvent) => void>,
  onLost: () => void,
) => {
  const source = new EventSource(url);
  let silence: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    clearTimeout(silence);
    source.close();
  };
  const lost = () => {
    close();
    onLost();
  };
  const heard = () => {
    clearTimeout(silence);
    silence = setTimeout(lost, SILENT_FOR_MS);
  };

  for (const name of ["open", HEARTBEAT, ...Object.keys(handlers)])
    source.addEventListener(name, heard);
  for (const [name, handle] of Object.entries(handlers))
    source.addEventListener(name, (event) => handle(event as MessageEvent));
  source.addEventListener("error", lost);
  heard();

  return { close, isOpen: () => source.readyState === EventSource.OPEN };
};
