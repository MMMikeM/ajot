import {
  InvalidSubscriptionError,
  rawPayload,
  sendPushBatch,
  WebPushError,
  type SendPushOptions,
  type VapidConfig,
} from "@mmmike/web-push/send";
import type { PushPayload, PushTrigger } from "@newtab-todo/shared";
import pushPreferenceRepo, { mutedKey } from "./db/push-preference.repo";
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
  payload: PushPayload,
  options?: SendPushOptions,
  attempt = 0,
): Promise<number> => {
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

type Recipient = { userId: string | null; deviceId: string | null };

/**
 * Drops each subscription whose device muted the trigger it would get. Only the PWA uploads a
 * device id, so the extensions' background sync can't be muted.
 */
export const withoutMuted = <S extends Recipient>(
  subs: S[],
  muted: Map<string, PushTrigger[]>,
  triggerFor: (sub: S) => PushTrigger,
) =>
  subs.filter(
    (sub) =>
      sub.userId === null ||
      sub.deviceId === null ||
      !muted.get(mutedKey(sub.userId, sub.deviceId))?.includes(triggerFor(sub)),
  );

export const findRecipients = async (userIds: string[]) => {
  const [subs, muted] = await Promise.all([
    pushSubscriptionRepo.findForUsers(userIds),
    pushPreferenceRepo.findMutedForUsers(userIds),
  ]);
  return { subs, muted };
};

/** Who made a change, and on which device. */
export type ChangeSource = { userId?: string; deviceId?: string };

/**
 * Wake the affected users' other devices to save the change, so each opens offline on it.
 * Extensions get a silent push. A web push has to show something (otherwise Chrome shows its own
 * notification and Safari revokes the permission), so the PWA gets a quiet one that replaces the
 * last; the device that made the change is skipped, as it already has it.
 * Expired/invalid subscriptions (410 Gone) are cleaned up automatically.
 */
export const notifyOtherDevices = async (userIds: string[], source: ChangeSource = {}) => {
  const { subs, muted } = await findRecipients(userIds);
  const extensions = subs.filter((sub) => sub.kind === "extension");
  // Only a worker new enough to show "changes" uploads a device id; an older one would show
  // nothing, which is the silent push Chrome and Safari punish. That also leaves out rows with no
  // user, which get every user's pushes.
  const web = withoutMuted(
    subs.filter(
      (sub) =>
        sub.kind === "web" &&
        sub.userId !== null &&
        sub.deviceId !== null &&
        sub.deviceId !== source.deviceId,
    ),
    muted,
    (sub) => (sub.userId === source.userId ? "own-changes" : "others-changes"),
  );

  // A device that was offline only needs the latest one, not one per mutation.
  const [silent, visible] = await Promise.all([
    extensions.length > 0 ? sendPush(extensions, { type: "sync" }, { topic: "sync" }) : 0,
    web.length > 0 ? sendPush(web, { type: "changes" }, { topic: "changes" }) : 0,
  ]);
  if (subs.length > 0)
    console.log(`Push: ${silent}/${extensions.length} silent, ${visible}/${web.length} visible`);
};
