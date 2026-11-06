import * as metricRepo from "../db/metric.repo";
import { createLimiter } from "../rate-limit";
import { Refusal } from "./api";
import type { McpCaller } from "./caller";

const calls = createLimiter({ limit: 120, windowMs: 60_000 });
const writes = createLimiter({ limit: 30, windowMs: 60_000 });

const text = (body: string) => ({ content: [{ type: "text" as const, text: body }] });

const count = (name: string) =>
  metricRepo.add(new Map([[name, 1]])).catch((err) => console.error("[mcp] couldn't count:", err));

/**
 * A tool's callback from a run that returns its reply as text. A route's refusal comes back as the
 * tool's error, in the route's own words; so does going over the token's rate.
 */
export const guarded =
  <A>(caller: McpCaller, name: string, run: (args: A) => Promise<string>, { write = false } = {}) =>
  async (args: A) => {
    const limiters = write ? [calls, writes] : [calls];
    const waitMs = Math.max(...limiters.map((l) => l.waitMs(caller.tokenId)));
    if (waitMs > 0)
      return { ...text(`Rate limited: try again in ${Math.ceil(waitMs / 1000)}s.`), isError: true };
    for (const l of limiters) l.count(caller.tokenId);
    void count(`mcp-call:${name}`.replaceAll("_", "-"));
    try {
      return text(await run(args));
    } catch (err) {
      if (err instanceof Refusal) return { ...text(err.message), isError: true };
      throw err;
    }
  };
