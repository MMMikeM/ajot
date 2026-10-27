import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { extractToken, validateSession } from "../auth";
import { registerClient, unregisterClient } from "../broadcast";

export const eventsRoute = new Hono().get("/", async (c) => {
  // EventSource can't set headers, so the stream alone takes the token in its URL; anywhere else
  // it would end up in logs and history
  const token = extractToken(c.req.raw) ?? c.req.query("token");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  let userId: string;
  try {
    userId = await validateSession(token);
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

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
