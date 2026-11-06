import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { hasRoomForStream, registerClient, unregisterClient } from "../broadcast";
import { UNAUTHORIZED } from "../db/errors";
import { redeemTicket } from "../stream-tickets";

export const eventsRoute = new Hono().get("/", (c) => {
  // EventSource can't set headers, and a URL ends up in logs and history, so a page trades its
  // token for a ticket that the stream's opening spends
  const ticket = c.req.query("ticket");
  const userId = ticket ? redeemTicket(ticket) : null;
  if (!userId) return c.json({ error: UNAUTHORIZED }, 401);

  // The tabs' and Firefox background's EventSource closes on it and backs off to a minute.
  // Nothing may await between this and registerClient, which streamSSE's callback runs in this
  // same tick, or two streams could both take the last room.
  if (!hasRoomForStream(userId))
    return c.json({ error: "Too many open connections. Close some tabs." }, 429);

  return streamSSE(c, async (stream) => {
    const writer = {
      write: (event: string, data: string) => {
        stream.writeSSE({ event, data }).catch(() => {});
      },
      close: () => stream.close(),
    };

    registerClient(userId, writer);
    await stream.writeSSE({ retry: 3000, data: "" });

    const heartbeat = setInterval(() => {
      stream.writeSSE({ data: "", event: "heartbeat" }).catch(() => {
        clearInterval(heartbeat);
        unregisterClient(userId, writer);
      });
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(heartbeat);
      unregisterClient(userId, writer);
    });

    // Hono closes the stream once this callback returns
    await new Promise(() => {});
  });
});
