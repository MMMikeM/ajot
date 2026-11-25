import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { hasRoomForStream, registerClient, unregisterClient } from "../broadcast";
import { UNAUTHORIZED } from "../db/errors";
import { redeemTicket } from "../stream-tickets";

// Hono queues each write until the client reads it, without limit, so a client that stops reading
// is cut off here, and its EventSource reconnects and refetches. Well above what one request sends
// at once, such as a list shared with its few hundred tasks.
const MAX_QUEUED_BYTES = 1024 * 1024;
const HEARTBEAT_MS = 30_000;

export const eventsRoute = new Hono().get("/", (c) => {
  // EventSource can't set headers, and a URL ends up in logs and history, so a page trades its
  // token for a ticket that the stream's opening spends
  const ticket = c.req.query("ticket");
  const owner = ticket ? redeemTicket(ticket) : null;
  if (!owner) return c.json({ error: UNAUTHORIZED }, 401);

  // The tabs' and Firefox background's EventSource closes on it and backs off to a minute.
  // Nothing may await between this and registerClient, which streamSSE's callback runs in this
  // same tick, or two streams could both take the last room.
  if (!hasRoomForStream(owner.userId))
    return c.json({ error: "Too many open connections. Close some tabs." }, 429);

  return streamSSE(c, async (stream) => {
    let queuedBytes = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let heartbeatUnread = false;
    let ended = () => {};
    const closed = new Promise<void>((resolve) => (ended = resolve));

    // Abort, not close: close waits for what's queued to be read, which a stalled client never does
    const end = () => {
      clearInterval(heartbeat);
      unregisterClient(owner.userId, writer);
      stream.abort();
      ended();
    };

    const send = async (event: string, data: string) => {
      const bytes = Buffer.byteLength(data);
      queuedBytes += bytes;
      if (queuedBytes > MAX_QUEUED_BYTES) return end();
      await stream.writeSSE({ event, data }).catch(() => {});
      queuedBytes -= bytes;
    };

    const writer = { write: (event: string, data: string) => void send(event, data), close: end };

    registerClient(owner, writer);
    stream.onAbort(end);
    await stream.writeSSE({ retry: 3000, data: "" });
    if (stream.aborted) return;

    // A heartbeat still unread at the next means the client read nothing for a whole interval: cut
    // off as one past the byte limit is, rather than left until its socket fails
    heartbeat = setInterval(() => {
      if (heartbeatUnread) return end();
      heartbeatUnread = true;
      void send("heartbeat", "").then(() => (heartbeatUnread = false));
    }, HEARTBEAT_MS);

    // Hono closes the stream once this callback returns
    await closed;
  });
});
