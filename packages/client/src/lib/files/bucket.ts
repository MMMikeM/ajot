import type { Fetcher } from "~/lib/api-client";

// The attachments bucket isn't one of the server's routes, so it has no typed client: it's reached
// only through URLs the server presigned, and only from here.

/** The browser sends the Blob's length as content-length, which the URL signed, as is the type. */
export const putToBucket = (
  url: string,
  blob: Blob,
  contentType: string,
  fetcher: Fetcher = fetch,
) => fetcher(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });

export const getFromBucket = (url: string, fetcher: Fetcher = fetch) => fetcher(url);
