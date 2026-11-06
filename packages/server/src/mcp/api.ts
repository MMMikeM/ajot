import { hc } from "hono/client";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppType } from "../app";
import type { McpCaller } from "./caller";

/** The app's own routes, as `caller`, without leaving the process. */
export const apiFor = (app: Pick<OpenAPIHono, "request">, caller: McpCaller) =>
  hc<AppType>("http://ajot.internal", {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input instanceof Request ? input : String(input), init, { mcpCaller: caller }),
    // So the user's own devices and tabs take the change as one made elsewhere
    headers: { "x-device-id": `mcp:${caller.tokenId}` },
  }).api;

export type Api = ReturnType<typeof apiFor>;

/** A route's refusal, whose message is already written for a person. */
export class Refusal extends Error {}

export const refusalOf = async (res: { status: number; json(): Promise<unknown> }) => {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return new Refusal(
    typeof body?.error === "string" ? body.error : `Ajot's server answered ${res.status}.`,
  );
};
