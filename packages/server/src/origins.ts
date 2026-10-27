const extensionProtocols = new Set(["chrome-extension:", "moz-extension:"]);

/** `ALLOWED_ORIGINS`, comma-separated: where a web app on another address than the API is served. */
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

/**
 * Who gets CORS headers: each extension, and a web app served from another address than the API.
 * The web app on the API's own address needs none, since its requests are same-origin.
 */
export const isAllowedOrigin = (origin: string, allowed: string[]) => {
  const url = URL.parse(origin);
  if (!url) return false;
  return extensionProtocols.has(url.protocol) || allowed.includes(url.origin);
};
