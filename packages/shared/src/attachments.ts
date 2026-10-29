// A blob URL runs on the app's origin, and the token is in its localStorage
export const OPENS_IN_TAB = [
  "application/pdf",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
] as const;

export const opensInTab = (mimeType: string) =>
  (OPENS_IN_TAB as readonly string[]).includes(mimeType);

/** What its bytes are stored and served as, so neither a page nor the bucket renders the rest. */
export const servedType = (mimeType: string) =>
  opensInTab(mimeType) ? mimeType : "application/octet-stream";
