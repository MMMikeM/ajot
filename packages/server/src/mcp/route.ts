import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMcpHandler, requireBearerAuth } from "@modelcontextprotocol/server";
import * as metricRepo from "../db/metric.repo";
import { apiFor } from "./api";
import { buildServer } from "./server";
import { callerOf, verifier } from "./verify";

/**
 * Mounts /mcp on the app it calls. Kept out of the routes `AppType` is built from, which the tools'
 * own client is typed by.
 */
export const mountMcp = (app: OpenAPIHono) => {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const caller = callerOf(authInfo);
      return buildServer(caller, apiFor(app, caller));
    },
    // Stateless, as deploys and restarts drop anything held in memory; and no held streams, which
    // would keep the machine from suspending
    { legacy: "stateless", responseMode: "json", maxSubscriptions: 0 },
  );
  const gate = requireBearerAuth({ verifier });

  // A client starts OAuth discovery on a 401, which the app's page would otherwise answer with a 200
  app.get("/.well-known/*", (c) => c.json({ error: "Not found" }, 404));

  app.all("/mcp", async (c) => {
    const origin = c.req.header("origin");
    if (origin) console.log(`[mcp] a request from origin ${origin}`);
    const auth = await gate(c.req.raw);
    if (auth instanceof Response) {
      metricRepo
        .add(new Map([["mcp-auth-fail", 1]]))
        .catch((err) => console.error("[mcp] couldn't count:", err));
      return auth;
    }
    return handler.fetch(c.req.raw, { authInfo: auth });
  });
};
