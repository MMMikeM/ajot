import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { authRoutes } from "./routes/auth";
import { taskRoutes } from "./routes/tasks";
import { categoryRoutes } from "./routes/categories";
import { noteRoutes } from "./routes/notes";
import { pushRoutes } from "./routes/push";
import { eventsRoute } from "./routes/events";
import { inviteRoutes } from "./routes/invites";
import { contactRoutes } from "./routes/contacts";
import { notificationRoutes } from "./routes/notifications";
import { deployRoutes } from "./routes/deploy";
import { configRoutes } from "./routes/config";
import { metricRoutes } from "./routes/metrics";
import { isAllowedOrigin, parseAllowedOrigins } from "./origins";
import { rejectInvalidInput } from "./routes/openapi-schemas";
import { LoggedHTTPException } from "./db/errors";

const app = new OpenAPIHono({ defaultHook: rejectInvalidInput });

// Far above the largest request the app makes, a list's delete naming every task it holds, and
// the longest note (db/field-limits.ts)
export const MAX_BODY_BYTES = 256 * 1024;

app.onError((err, c) => {
  if (err instanceof LoggedHTTPException) console.warn(`[${err.status}] ${err.detail}`);
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  // Drizzle wraps the driver's error, so the SQLITE_CONSTRAINT code and "FOREIGN KEY" message
  // live on err.cause. 422 is non-retriable on the client (assertOk treats any 4xx that way),
  // so the mutation is dropped rather than retried forever.
  const cause = err.cause;
  const constraint =
    cause instanceof Error &&
    "code" in cause &&
    (cause as { code: string }).code === "SQLITE_CONSTRAINT" &&
    cause.message;
  if (constraint && constraint.includes("FOREIGN KEY")) {
    console.error("[db] FK constraint failed:", constraint);
    return c.json({ error: "Part of this no longer exists, so it wasn't saved." }, 422);
  }
  if (constraint && constraint.includes("CHECK")) {
    console.error("[db] CHECK constraint failed:", constraint);
    return c.json({ error: "That change isn't one the app can save." }, 422);
  }
  console.error(err);
  return c.json({ error: "Something went wrong on the server. Try again." }, 500);
});

// Compress all responses except SSE (streamSSE is a streaming response — buffered
// compression would break it by preventing chunks from flushing to the client).
app.use("*", async (c, next) => {
  if (c.req.path === "/api/events") return next();
  return compress()(c, next);
});

app.use(
  "*",
  secureHeaders({
    xFrameOptions: "DENY",
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
  }),
);

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

// CORS — needed for extension context (moz-extension:// origin).
// Headers are set BEFORE next() so they're present on error responses too:
// if a route throws HTTPException, onError() calls c.json() which picks up
// whatever is already in c._headers — but post-next() code is never reached.
// No Allow-Credentials: see extractToken.
app.use("*", (c, next) => {
  c.header("Vary", "Origin", { append: true });
  const origin = c.req.header("origin");
  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Client-Id,X-Device-Id");
    c.header("Access-Control-Expose-Headers", "*");
    c.header("Access-Control-Max-Age", "86400");
  }
  return next();
});

app.options("*", (c) => c.body(null, 204));

// After CORS, so an extension is shown this answer rather than a CORS failure
app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "That's too much to save in one go." }, 413),
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

const api = app
  .route("/api/config", configRoutes)
  .route("/api/auth", authRoutes)
  .route("/api/tasks", taskRoutes)
  .route("/api/categories", categoryRoutes)
  .route("/api/notes", noteRoutes)
  .route("/api/push", pushRoutes)
  .route("/api/events", eventsRoute)
  .route("/api/invites", inviteRoutes)
  .route("/api/contacts", contactRoutes)
  .route("/api/notifications", notificationRoutes)
  .route("/api/deploy", deployRoutes)
  .route("/api/metrics", metricRoutes);

app.doc("/api/openapi.json", {
  openapi: "3.0.0",
  info: { title: "NewTab Todo API", version: "1.0.0" },
});

export type AppType = typeof api;
export default app;
