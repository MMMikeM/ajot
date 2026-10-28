import { isIP } from "node:net";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { HTTPException } from "hono/http-exception";

/**
 * Counts what each key does in a fixed window. Kept in this process: the app runs on one machine,
 * as SSE and the push queue already assume, so a restart or deploy starts every count afresh.
 */
export const createLimiter = ({ limit, windowMs }: { limit: number; windowMs: number }) => {
  const windows = new Map<string, { count: number; endsAt: number }>();
  // Plenty for one server's people, and small enough that a flood of keys can't grow it unbounded
  const MAX_KEYS = 10_000;

  const current = (key: string) => {
    const window = windows.get(key);
    if (!window || window.endsAt <= Date.now()) return undefined;
    return window;
  };

  return {
    /** Milliseconds until the key may try again, or 0 if it may now. */
    waitMs: (key: string) => {
      const window = current(key);
      return window && window.count >= limit ? window.endsAt - Date.now() : 0;
    },
    count: (key: string) => {
      const window = current(key);
      if (window) {
        window.count++;
        return;
      }
      if (windows.size >= MAX_KEYS)
        for (const [stale, { endsAt }] of windows) if (endsAt <= Date.now()) windows.delete(stale);
      if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value!);
      windows.set(key, { count: 1, endsAt: Date.now() + windowMs });
    },
    clear: (key: string) => void windows.delete(key),
  };
};

export type Limiter = ReturnType<typeof createLimiter>;

const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

const unmapped = (address: string) => IPV4_MAPPED.exec(address)?.[1] ?? address;

const isLoopback = (address: string) => address.startsWith("127.") || address === "::1";

/** RFC 1918, unique local (fc00::/7) and link-local: where a proxy in front of this server sits. */
const isPrivate = (address: string) => {
  if (isIP(address) === 4) {
    const [a, b = 0] = address.split(".").map(Number);
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return /^(f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(address);
};

/**
 * The key an address is limited by. An IPv6 address by its /64, the block one subscriber or server
 * is given, since anyone holding one can send from as many addresses in it as they like.
 */
export const limitedAs = (address: string) => {
  const mapped = IPV4_MAPPED.exec(address);
  if (mapped) return mapped[1]!;
  if (!address.includes(":")) return address;
  const [head = "", tail] = address.split("%")[0]!.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
};

const socketAddress = (c: Context) => {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // A request made in-process, as the tests make them, has no socket
    return undefined;
  }
};

/** The last address in X-Forwarded-For: the one the proxy in front of this server added. */
const forwardedFor = (c: Context) => {
  const added = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
  return added && isIP(added) ? added : undefined;
};

const clientAddress = (c: Context) => {
  const flyClientIp = process.env.FLY_APP_NAME ? c.req.header("fly-client-ip") : undefined;
  if (flyClientIp) return flyClientIp;
  const peer = socketAddress(c);
  if (!peer) return undefined;
  const local = unmapped(peer);
  return isLoopback(local) || isPrivate(local) ? forwardedFor(c) : peer;
};

/**
 * Who sent the request, to limit by. Fly's proxy sets Fly-Client-IP on every request, overwriting
 * one a client sent. Anywhere else a client can make up any header, so the socket's address is
 * used, unless it's this machine or a private network's: that's a proxy every request would share,
 * so limiting it would lock everyone out at once. Through one, the client is the address it added
 * to X-Forwarded-For, and with none there's no one to limit (docs/self-hosting.md).
 */
export const limitableIp = (c: Context) => {
  const address = clientAddress(c);
  return address && !isLoopback(unmapped(address)) ? limitedAs(address) : undefined;
};

/** The limiters to check: the address's only when there's one to limit by. */
export const limitsFor = (byIp: Limiter, ip: string | undefined, rest: [Limiter, string][]) =>
  ip ? [[byIp, ip] as [Limiter, string], ...rest] : rest;

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/** Refuses with a 429 the client shows, if any of the keys has used up its limiter. */
export const refuseIfLimited = (
  c: Context,
  checks: [Limiter, string][],
  action: "signing in" | "signing up",
) => {
  const waitMs = Math.max(0, ...checks.map(([limiter, key]) => limiter.waitMs(key)));
  if (waitMs === 0) return;
  c.header("Retry-After", String(Math.ceil(waitMs / 1000)));
  const wait = minutes(waitMs);
  throw new HTTPException(429, {
    message: `Too many tries at ${action}. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`,
  });
};

// Each one notifies someone, so a script can't flood a person's phone with titles it chose
const sharing = createLimiter({
  limit: Number(process.env.SHARES_PER_10_MINUTES) || 30,
  windowMs: 10 * 60_000,
});

/** Counts a share, send or list invite by this user, and refuses one too many. */
export const limitSharing = (userId: string) => {
  if (sharing.waitMs(userId) > 0)
    throw new HTTPException(429, {
      message: "That's a lot of sharing at once. Try again in a few minutes.",
    });
  sharing.count(userId);
};
