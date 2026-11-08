import { z } from "@hono/zod-openapi";
import * as metricRepo from "../db/metric.repo";
import { authed, authedRoute } from "../middleware";
import { jsonBody } from "./crud";

export const metricRoutes = authed().openapi(
  authedRoute({
    method: "post",
    path: "/",
    request: jsonBody(z.object({ name: metricRepo.nameSchema })),
    // A name past the day's cap gets a 204 too: its sender has nothing to fix or retry
    responses: { 204: true },
  }),
  async (c) => {
    await metricRepo.incrementIfRoom(c.req.valid("json").name);
    return c.body(null, 204);
  },
);
