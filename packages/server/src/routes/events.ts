import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { extractToken, validateSession } from "../auth";
import { hasRoomForStream, registerClient, unregisterClient } from "../broadcast";
import { UNAUTHORIZED } from "../db/errors";
import { redeemTicket } from "../stream-tickets";

// EventSource can't set headers, and a URL ends up in logs and history, so a page trades its
// token for a ticket that the stream's opening spends. Clients from before tickets still send the
// token itself in the URL.
const userOf = async (request: Request, query: (name: string) => string | undefined) => {
  const ticket = query("ticket");
  if (ticket) return redeemTicket(ticket);
  const token = extractToken(request) ?? query("token");
  if (!token) return null;
  return validateSession(token).catch(() => null);
};

export const eventsRoute = new Hono().get("/", async (c) => {
  const userId = await userOf(c.req.raw, (name) => c.req.query(name));
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
