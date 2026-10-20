import { Hono } from "hono";
import pushSubscriptionRepo from "../db/push-subscription.repo";
import { sendPush } from "../push";

export const deployRoutes = new Hono();

deployRoutes.post("/notify", async (c) => {
  const secret = c.req.header("X-Deploy-Secret");
  if (!secret || secret !== process.env.DEPLOY_PUSH_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subs = await pushSubscriptionRepo.findByKind("extension");
  const sent = await sendPush(subs, { type: "deploy" }, { topic: "deploy" });
  console.log(`Deploy push: ${sent}/${subs.length} delivered`);
  return c.json({ sent, total: subs.length });
});
