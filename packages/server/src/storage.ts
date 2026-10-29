import { AwsClient } from "aws4fetch";

const UPLOAD_URL_SECONDS = 15 * 60;
const DOWNLOAD_URL_SECONDS = 60 * 60;

export const fileKey = (id: string) => `a/${id}`;
export const thumbKey = (id: string) => `t/${id}`;

/** What `fly storage create` sets. Without a bucket there's no storage, and attachments are off. */
export const storageFrom = (env: Record<string, string | undefined>) => {
  const {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_ENDPOINT_URL_S3: endpoint,
    BUCKET_NAME: bucket,
  } = env;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return undefined;
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: env.AWS_REGION || "auto",
  });
  // Path-style, so the endpoint's one origin covers every object
  const objectUrl = (key: string) => new URL(`${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`);

  const presign = async (
    method: "GET" | "PUT",
    key: string,
    seconds: number,
    {
      headers = {},
      query = {},
    }: { headers?: Record<string, string>; query?: Record<string, string> },
  ) => {
    const url = objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(seconds));
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    // Without allHeaders, content-length and content-type go unsigned, so the upload's size isn't
    // held to what the server checked, and Tigris refuses headers a signature doesn't cover
    const signed = await aws.sign(url, {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  };

  const send = async (method: "HEAD" | "DELETE", key: string) => {
    const res = await aws.fetch(objectUrl(key), { method });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${key} answered ${res.status}`);
    return res;
  };

  return {
    /** The browser must send both headers with these values. */
    presignPut: (key: string, size: number, contentType: string) =>
      presign("PUT", key, UPLOAD_URL_SECONDS, {
        headers: { "content-length": String(size), "content-type": contentType },
      }),
    presignGet: (key: string, contentDisposition: string) =>
      presign("GET", key, DOWNLOAD_URL_SECONDS, {
        query: { "response-content-disposition": contentDisposition },
      }),
    /** Undefined when there's no such object. */
    sizeOf: async (key: string) => {
      const res = await send("HEAD", key);
      return res.status === 404 ? undefined : Number(res.headers.get("content-length"));
    },
    remove: async (key: string) => void (await send("DELETE", key)),
  };
};

export const storage = storageFrom(process.env);
