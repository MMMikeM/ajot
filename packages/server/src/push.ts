import {
  InvalidSubscriptionError,
  rawPayload,
  sendPushBatch,
  WebPushError,
  type SendPushOptions,
  type VapidConfig,
} from "@mmmike/web-push/send";
import type { PushMessage } from "@newtab-todo/shared";
import pushPreferenceRepo from "./db/push-preference.repo";
import { fitted } from "./push-plan";
import pushSubscriptionRepo from "./db/push-subscription.repo";

const vapid: VapidConfig = {
  subject: process.env.VAPID_SUBJECT!,
  publicKey: process.env.VAPID_PUBLIC_KEY!,
  privateKey: process.env.VAPID_PRIVATE_KEY!,
};

type StoredSubscription = { endpoint: string; p256dh: string; auth: string; createdAt: string };

// Google's push service can answer 410 for a subscription made seconds ago, until it has
// registered it, so one that new is tried again before it's deleted
const REGISTERING_FOR_MS = 2 * 60_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 40_000];

const isRegistering = (sub: StoredSubscription) =>
  Date.now() - Date.parse(sub.createdAt) < REGISTERING_FOR_MS;

// Per the library: a 429 or 5xx, or the network (TypeError, TimeoutError); anything else fails the
// same way again
const isWorthRetrying = (error: unknown) =>
  error instanceof WebPushError
    ? error.statusCode === 429 || error.statusCode >= 500
    : error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");

const retryAfterMs = (error: unknown) =>
  error instanceof WebPushError ? (error.retryAfterMs ?? 0) : 0;

/**
 * Send a typed payload to the given subscriptions, deleting the ones the push service reports
 * gone. A just-made subscription reported gone, or a send that failed for a moment, is tried
 * again a few times. Failed sends are logged, never thrown. Returns how many were delivered on
 * this first try.
 */
export const sendPush = async (
  subs: StoredSubscription[],
  message: PushMessage,
  options?: SendPushOptions,
  attempt = 0,
): Promise<number> => {
  const payload = fitted(message);
  if (!payload) {
    console.error(`Push [${message.type}] dropped: too large to send`);
    return 0;
  }
  const { delivered, gone, failed } = await sendPushBatch(
    subs.map((sub) => ({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } })),
    // The service workers parse our own PushPayload union, not the library's notification shape.
    rawPayload(JSON.stringify(payload)),
    vapid,
    options,
  );
  const malformed = failed.filter(({ error }) => error instanceof InvalidSubscriptionError);
  const delayMs = RETRY_DELAYS_MS[attempt];
  const registering =
    delayMs === undefined
      ? []
      : subs.filter((sub) => gone.includes(sub.endpoint) && isRegistering(sub));
  const transient =
    delayMs === undefined ? [] : failed.filter(({ error }) => isWorthRetrying(error));

  const removed = gone.filter((endpoint) => !registering.some((sub) => sub.endpoint === endpoint));
  await pushSubscriptionRepo.removeMany([...removed, ...malformed.map(({ endpoint }) => endpoint)]);

  const again = subs.filter(
    (sub) =>
      registering.includes(sub) || transient.some(({ endpoint }) => endpoint === sub.endpoint),
  );
  if (delayMs !== undefined && again.length > 0) {
    const waitMs = Math.max(delayMs, ...transient.map(({ error }) => retryAfterMs(error)));
    setTimeout(() => void sendPush(again, payload, options, attempt + 1), waitMs);
  }

  const logged = failed.filter(({ error }) => !(error instanceof InvalidSubscriptionError));
  if (logged.length > 0) {
    console.warn(
      `Push [${payload.type}] failed${transient.length > 0 ? ", retrying" : ""}:`,
      logged.map(({ error }) => (error instanceof WebPushError ? error.toJSON() : String(error))),
    );
  }
  return delivered;
};

export const findRecipients = async (userIds: string[]) => {
  const [subs, preferences] = await Promise.all([
    pushSubscriptionRepo.findForUsers(userIds),
    pushPreferenceRepo.findForUsers(userIds),
  ]);
  return { subs, preferences };
};
