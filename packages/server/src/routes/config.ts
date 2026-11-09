import { OpenAPIHono, z } from "@hono/zod-openapi";
import * as userRepo from "../db/user.repo";
import { route } from "./crud";
import { storage } from "../storage";
import { MAX_ATTACHMENT_BYTES } from "../attachment-limits";

const configSchema = z.object({
  vapidPublicKey: z.string(),
  // No accounts yet: the first signup needs no invite
  awaitingFirstUser: z.boolean(),
  // Null without a bucket, which turns attachments off
  attachments: z.object({ maxBytes: z.number() }).nullable(),
  // The one Android app a page may sign the widget in for: a launch's referrer must name it
  androidPackage: z.string().nullable(),
});

/** What a client needs to know about the server it was pointed at, before signing in. */
export const configRoutes = new OpenAPIHono().openapi(
  route({
    method: "get",
    path: "/",
    responses: { 200: configSchema },
  }),
  async (c) =>
    c.json(
      {
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
        awaitingFirstUser: (await userRepo.count()) === 0,
        attachments: storage ? { maxBytes: MAX_ATTACHMENT_BYTES } : null,
        androidPackage: process.env.ANDROID_PACKAGE_NAME || null,
      },
      200,
    ),
);
