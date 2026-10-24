import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import userRepo from "../db/user.repo";
import { jsonContent } from "./crud";

const configSchema = z.object({
  vapidPublicKey: z.string(),
  // No accounts yet: the first signup needs no invite
  awaitingFirstUser: z.boolean(),
});

/** What a client needs to know about the server it was pointed at, before signing in. */
export const configRoutes = new OpenAPIHono().openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: { 200: jsonContent(configSchema) },
  }),
  async (c) =>
    c.json(
      {
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
        awaitingFirstUser: (await userRepo.count()) === 0,
      },
      200,
    ),
);
