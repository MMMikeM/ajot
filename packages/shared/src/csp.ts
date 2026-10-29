/** Report-only until a deploy has shown nothing the app does breaks it. */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/**
 * The PWA's policy: the server sends it, and `vp preview` sends the same one so the e2e suites
 * run under it. The token lives in localStorage, so a script on the app's origin owns the account.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // For the critical CSS's <style> and the style attributes the prerender writes
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
