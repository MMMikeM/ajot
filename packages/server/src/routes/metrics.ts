import { z } from "@hono/zod-openapi";
import * as metricRepo from "../db/metric.repo";
import { authed, authedRoute } from "../middleware";
import { jsonBody } from "./crud";

export const metricRoutes = authed()
  .openapi(
    authedRoute({
      method: "post",
      path: "/",
      request: jsonBody(z.object({ name: metricRepo.nameSchema })),
      responses: { 204: true },
    }),
    async (c) => {
      await metricRepo.increment(c.req.valid("json").name);
      return c.body(null, 204);
    },
  )
  .openapi(
    authedRoute({
      method: "get",
      path: "/",
      request: { query: z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }) },
      responses: {
        200: z.object({
          totals: z.record(z.string(), z.number()),
          days: z.array(metricRepo.countSchema),
        }),
      },
    }),
    async (c) => {
      const days = await metricRepo.listSince(c.req.valid("query").days);
      const totals: Record<string, number> = {};
      for (const row of days) totals[row.name] = (totals[row.name] ?? 0) + row.count;
      return c.json({ totals, days }, 200);
    },
  );
