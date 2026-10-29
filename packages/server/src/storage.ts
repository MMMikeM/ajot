import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

const UPLOAD_URL_SECONDS = 15 * 60;
const DOWNLOAD_URL_SECONDS = 60 * 60;

export const fileKey = (id: string) => `a/${id}`;
export const thumbKey = (id: string) => `t/${id}`;
// An upload URL stays valid after /complete, so the browser writes here and /complete copies what
// it checked to the key everyone is served from
export const stagedKey = (key: string) => `u/${key}`;

/** encodeURIComponent leaves !'()* alone, which S3's signatures and RFC 5987 both escape. */
export const encodeRfc3986 = (text: string) =>
  encodeURIComponent(text).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

type Query = Record<string, string | string[] | null>;

/** What `fly storage create` sets. Without a bucket there's no storage, and attachments are off. */
export const storageFrom = (env: Record<string, string | undefined>) => {
  const {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_ENDPOINT_URL_S3: endpoint,
    BUCKET_NAME: bucket,
  } = env;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) return undefined;
  const signer = new SignatureV4({
    service: "s3",
    region: env.AWS_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
    sha256: Hash.bind(null, "sha256"),
    // Keys are made of URL-safe characters, and S3 signs the path as it's sent
    uriEscapePath: false,
    applyChecksum: false,
  });
  const base = new URL(endpoint);

  // Path-style, so the endpoint's one origin covers every object. S3 refuses a request whose
  // payload isn't covered by the signature, and the browser's body can't be hashed in advance.
  const request = (
    method: string,
    key: string,
    headers: Record<string, string> = {},
    query: Query = {},
  ) =>
    new HttpRequest({
      method,
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port ? Number(base.port) : undefined,
      path: key ? `/${bucket}/${key}` : `/${bucket}`,
      query,
      headers: { host: base.host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", ...headers },
    });

  const urlOf = ({ path, query = {} }: { path: string; query?: Query }) => {
    const params = Object.entries(query).flatMap(([name, value]) =>
      [value ?? []].flat().map((v) => `${encodeRfc3986(name)}=${encodeRfc3986(v)}`),
    );
    return `${base.origin}${path}${params.length ? `?${params.join("&")}` : ""}`;
  };

  const presign = async (
    method: "GET" | "PUT",
    key: string,
    seconds: number,
    { headers, query }: { headers?: Record<string, string>; query?: Query },
  ) => urlOf(await signer.presign(request(method, key, headers, query), { expiresIn: seconds }));

  const send = async (
    method: "GET" | "HEAD" | "DELETE" | "PUT",
    key: string,
    headers?: Record<string, string>,
    query?: Query,
  ) => {
    const signed = await signer.sign(request(method, key, headers, query));
    const res = await fetch(urlOf(signed), { method, headers: signed.headers });
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
    copy: async (from: string, to: string) => {
      const res = await send("PUT", to, { "x-amz-copy-source": `/${bucket}/${from}` });
      // A copy can fail after S3 has answered 200, with the error in the body
      const body = await res.text();
      if (res.status === 404 || body.includes("<Error>"))
        throw new Error(`copying ${from} to ${to} failed: ${body}`);
    },
    remove: async (key: string) => void (await send("DELETE", key)),
    /** Every object, a page of ListObjectsV2 at a time. */
    list: async function* () {
      let token: string | undefined;
      do {
        const query: Query = { "list-type": "2" };
        if (token) query["continuation-token"] = token;
        const page = await (await send("GET", "", undefined, query)).text();
        for (const [, object] of page.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g))
          yield {
            key: /<Key>(.*?)<\/Key>/.exec(object!)![1]!,
            lastModified: /<LastModified>(.*?)<\/LastModified>/.exec(object!)![1]!,
          };
        token = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(page)?.[1];
      } while (token);
    },
  };
};

export const storage = storageFrom(process.env);
