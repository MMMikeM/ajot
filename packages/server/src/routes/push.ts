import { z } from "@hono/zod-openapi";
import { isPushServiceEndpoint } from "@mmmike/web-push/send";
import * as pushPreferenceRepo from "../db/push-preference.repo";
import * as pushSubscriptionRepo from "../db/push-subscription.repo";
import { pushSubscriptionKinds } from "../db/schema";
import { authed, authedRoute } from "../middleware";
import { jsonBody, okBody } from "./crud";
import { MAX_ID } from "@newtab-todo/shared/field-limits";
import { okSchema } from "./openapi-schemas";

// Push services' endpoints run to a few hundred characters
const MAX_ENDPOINT = 2_000;

const subscriptionSchema = z.object({
  // The server posts to whatever endpoint is stored, so only accept browser push services.
  endpoint: z
    .url()
    .max(MAX_ENDPOINT)
    .refine(isPushServiceEndpoint, "Not a browser push service endpoint"),
  keys: z.object({ p256dh: z.string().max(MAX_ID), auth: z.string().max(MAX_ID) }),
});

// Preferences are per device, since each device has its own subscription
const deviceHeaders = z.object({ "x-device-id": z.string().min(1).max(MAX_ID) });

export const pushRoutes = authed()
  .openapi(
    authedRoute({
      method: "post",
      path: "/subscribe",
      request: {
        query: z.object({ kind: z.enum(pushSubscriptionKinds).default("web") }),
        headers: z.object({ "x-device-id": z.string().max(MAX_ID).optional() }),
        ...jsonBody(subscriptionSchema),
      },
      responses: { 200: okSchema },
    }),
    async (c) => {
      const { endpoint, keys } = c.req.valid("json");
      const { kind } = c.req.valid("query");
      await pushSubscriptionRepo.upsert({
        endpoint,
        ...keys,
        kind,
        userId: c.get("userId"),
        deviceId: c.req.valid("header")["x-device-id"] ?? null,
      });
      return c.json(okBody, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "post",
      path: "/unsubscribe",
      request: jsonBody(z.object({ endpoint: z.string().max(MAX_ENDPOINT) })),
      responses: { 200: okSchema },
    }),
    async (c) => {
      await pushSubscriptionRepo.removeOwn(c.req.valid("json").endpoint, c.get("userId"));
      return c.json(okBody, 200);
    },
  )
  .openapi(
    authedRoute({
      method: "get",
      path: "/preferences",
      request: { headers: deviceHeaders },
      responses: { 200: pushPreferenceRepo.preferencesSchema },
    }),
    async (c) =>
      c.json(
        await pushPreferenceRepo.find(c.get("userId"), c.req.valid("header")["x-device-id"]),
        200,
      ),
  )
  .openapi(
    authedRoute({
      method: "put",
      path: "/preferences",
      request: { headers: deviceHeaders, ...jsonBody(pushPreferenceRepo.preferencesSchema) },
      responses: { 200: okSchema },
    }),
    async (c) => {
      await pushPreferenceRepo.save(
        c.get("userId"),
        c.req.valid("header")["x-device-id"],
        c.req.valid("json"),
      );
      return c.json(okBody, 200);
    },
  );
