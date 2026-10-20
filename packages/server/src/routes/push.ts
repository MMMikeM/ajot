import { createRoute, z } from "@hono/zod-openapi";
import pushSubscriptionRepo from "../db/push-subscription.repo";
import { pushSubscriptionKinds } from "../db/schema";
import { authed } from "../middleware";
import { okSchema } from "./openapi-schemas";
import { jsonBody, jsonContent, withAuth } from "./crud";

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const pushRoutes = authed()
  .openapi(
    createRoute({
      method: "post",
      path: "/subscribe",
      request: {
        query: z.object({ kind: z.enum(pushSubscriptionKinds).default("web") }),
        ...jsonBody(subscriptionSchema),
      },
      responses: withAuth({ 200: jsonContent(okSchema) }),
    }),
    async (c) => {
      const { endpoint, keys } = c.req.valid("json");
      const { kind } = c.req.valid("query");
      await pushSubscriptionRepo.upsert({ endpoint, ...keys, kind, userId: c.get("userId") });
      return c.json({ ok: true as const }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/unsubscribe",
      request: jsonBody(z.object({ endpoint: z.string() })),
      responses: withAuth({ 200: jsonContent(okSchema) }),
    }),
    async (c) => {
      await pushSubscriptionRepo.remove(c.req.valid("json").endpoint);
      return c.json({ ok: true as const }, 200);
    },
  );
