import { Hono } from "hono";
import * as pushSubscriptionRepo from "../db/push-subscription.repo";
import { sendPush } from "../push";
import { isSecret } from "../secret";
import { UNAUTHORIZED } from "../db/errors";

export const deployRoutes = new Hono();

deployRoutes.post("/notify", async (c) => {
  if (!isSecret(c.req.header("X-Deploy-Secret"), process.env.DEPLOY_PUSH_SECRET)) {
    return c.json({ error: UNAUTHORIZED }, 401);
  }

  const subs = await pushSubscriptionRepo.findByKind("extension");
  const sent = await sendPush(subs, { type: "deploy" }, { topic: "deploy" });
  console.log(`Deploy push: ${sent}/${subs.length} delivered`);
  return c.json({ sent, total: subs.length });
});
