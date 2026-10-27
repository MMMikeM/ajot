const extensionProtocols = new Set(["chrome-extension:", "moz-extension:"]);

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** `ALLOWED_ORIGINS`, comma-separated, for a server whose proxy rewrites the Host header. */
export const parseAllowedOrigins = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      // A scheme other than http(s) has the opaque origin "null", which would match any other
      const origin = URL.parse(entry)?.origin;
      if (origin && origin !== "null") return [origin];
      console.error(`[cors] ignoring ALLOWED_ORIGINS entry "${entry}": not an http(s) origin`);
      return [];
    });

type IncomingRequest = {
  origin: string | undefined;
  /** The Host header. Compared without the scheme: TLS ends at Fly's proxy, so it's http here. */
  host: string | undefined;
  method: string;
  secFetchSite: string | undefined;
};

/**
 * The PWA calls its own origin, and each extension calls from its own origin with a Bearer token.
 * The dev and preview proxies rewrite Host, so a page behind them is known by Sec-Fetch-Site.
 */
export const isAllowedOrigin = (origin: string, host: string | undefined, allowed: string[]) => {
  const url = URL.parse(origin);
  if (!url) return false;
  if (extensionProtocols.has(url.protocol)) return true;
  if (host && url.host === host.toLowerCase()) return true;
  return allowed.includes(url.origin);
};

/**
 * A write from a page on another origin is refused. Nothing authenticates by cookie, so a write
 * that needs a session can't come from another site anyway; this covers the ones that don't, such
 * as another site's form signing someone in or up. The browser's own Sec-Fetch-Site vouches for a
 * same-origin request, which can arrive with `Origin: null` under the no-referrer policy, or with
 * a Host header a proxy rewrote.
 */
export const isCrossOriginWrite = (
  { origin, host, method, secFetchSite }: IncomingRequest,
  allowed: string[],
) =>
  !safeMethods.has(method) &&
  origin !== undefined &&
  secFetchSite !== "same-origin" &&
  !isAllowedOrigin(origin, host, allowed);
