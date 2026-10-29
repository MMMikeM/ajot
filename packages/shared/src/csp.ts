/** Report-only until a deploy has shown nothing the app does breaks it. */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/** `bucketEndpoint` is `AWS_ENDPOINT_URL_S3`, where presigned uploads and downloads go. */
export const contentSecurityPolicy = (bucketEndpoint?: string) =>
  [
    "default-src 'self'",
    "script-src 'self'",
    // The inlined stylesheet and the style attributes the prerender writes
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    bucketEndpoint ? `connect-src 'self' ${new URL(bucketEndpoint).origin}` : "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
