/** Report-only until a deploy has shown nothing the app does breaks it. */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // The inlined stylesheet and the style attributes the prerender writes
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
