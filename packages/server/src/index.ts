import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import app from "./app";
import { closeAllClients } from "./broadcast";
import { flushPushes } from "./push-queue";

// Prevent silent crashes from async errors (e.g. a dead socket surfacing on a
// just-restored network after Fly suspend/resume).
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const clientDist =
  process.env.CLIENT_DIST_PATH || resolve(import.meta.dirname, "../../client/dist");

// Vite content-hashes these filenames, so they can be cached forever
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
});

app.use("*", serveStatic({ root: clientDist }));

// A chunk from an earlier deploy is gone. Without this it would get index.html with a 200, and the
// import would fail on the MIME type instead of a clean 404 the client can recover from.
app.get("/assets/*", (c) => c.notFound());

app.get("*", serveStatic({ root: clientDist, path: "index.html" }));

const port = Number(process.env.PORT || 3000);
console.log(`Server listening on http://0.0.0.0:${port}`);
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });

const shutdown = (signal: string) => {
  console.log(`[${signal}] shutting down`);
  // Close SSE streams first — they hold the server open indefinitely.
  closeAllClients();
  // Pushes wait a moment to group changes, so send any still waiting first
  void flushPushes().finally(() => server.close(() => process.exit(0)));
  setTimeout(() => {
    console.error("[shutdown] forced exit after timeout");
    process.exit(1);
  }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
