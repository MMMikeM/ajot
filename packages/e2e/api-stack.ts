import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { API_PORT } from "./helpers/stack";

// Pinned, so a new image can't change the database or the bucket under the suite
const IMAGE =
  "ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67";
// versitygw 1.10.0, which checks signatures, so a PUT past its signed length fails here as on Tigris
const S3_IMAGE =
  "versity/versitygw@sha256:89cad13cc981986ee284cbafea4613f9533ce6fd5f37a2c96c4c4fb8adb3a316";
const S3 = { key: "e2e", secret: "e2e-secret", bucket: "ajot", region: "us-east-1" };
const LABEL = "ajot-e2e";
const ROOT = resolve(import.meta.dirname, "../..");

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

// A run killed outright never reaches its exit handler, so its container is cleared here
const leftovers = docker("ps", "-aq", "--filter", `label=${LABEL}`);
if (leftovers) docker("rm", "-f", ...leftovers.split("\n"));

const start = async (port: number, readyAt: string, args: string[]) => {
  const ports = ["-p", `127.0.0.1::${port}`];
  const container = docker("run", "-d", "--rm", "--label", LABEL, ...ports, ...args);
  process.on("exit", () => {
    try {
      docker("rm", "-f", container);
    } catch {
      // Already gone
    }
  });
  const url = `http://${docker("port", container, `${port}/tcp`).split("\n")[0]}`;
  for (let attempt = 0; ; attempt++) {
    // The bucket's root refuses an unsigned request once it's up
    const ready = await fetch(`${url}${readyAt}`).then(
      (res) => res.ok || res.status === 403,
      () => false,
    );
    if (ready) return url;
    if (attempt === 100) throw new Error(`${args.at(-1)} at ${url} never answered`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

const [dbUrl, s3Url] = await Promise.all([
  start(8080, "/health", [IMAGE]),
  start(7070, "/", [
    "-e",
    `ROOT_ACCESS_KEY=${S3.key}`,
    "-e",
    `ROOT_SECRET_KEY=${S3.secret}`,
    S3_IMAGE,
    "posix",
    "/tmp",
  ]),
]);

// As the bucket's setup in docs/self-hosting.md: a presigned URL is the credential, so any origin
const signer = new SignatureV4({
  service: "s3",
  region: S3.region,
  credentials: { accessKeyId: S3.key, secretAccessKey: S3.secret },
  sha256: Hash.bind(null, "sha256"),
});
const bucketUrl = new URL(`${s3Url}/${S3.bucket}`);
const putToBucket = async (query: Record<string, string>, body = "") => {
  const signed = await signer.sign(
    new HttpRequest({
      method: "PUT",
      protocol: bucketUrl.protocol,
      hostname: bucketUrl.hostname,
      port: Number(bucketUrl.port),
      path: bucketUrl.pathname,
      query,
      body,
      headers: {
        host: bucketUrl.host,
        ...(body && { "content-md5": createHash("md5").update(body).digest("base64") }),
      },
    }),
  );
  const search = new URLSearchParams(query).toString();
  const res = await fetch(`${bucketUrl}${search && `?${search}`}`, {
    method: "PUT",
    headers: signed.headers,
    body: body || undefined,
  });
  if (!res.ok) throw new Error(`Setting up the bucket answered ${res.status}: ${await res.text()}`);
};
await putToBucket({});
await putToBucket(
  { cors: "" },
  `<CORSConfiguration><CORSRule><AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`,
);

const env = {
  ...process.env,
  TURSO_DATABASE_URL: dbUrl,
  TURSO_AUTH_TOKEN: "e2e",
  AWS_ACCESS_KEY_ID: S3.key,
  AWS_SECRET_ACCESS_KEY: S3.secret,
  AWS_ENDPOINT_URL_S3: s3Url,
  AWS_REGION: S3.region,
  BUCKET_NAME: S3.bucket,
  PORT: String(API_PORT),
  VAPID_SUBJECT: "mailto:e2e@example.com",
  // Each worker's Alice shares far more in a run than a person would in ten minutes
  SHARES_PER_10_MINUTES: "100000",
};
const pnpm = (...args: string[]) =>
  execFileSync("pnpm", ["--filter", "@newtab-todo/server", ...args], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
pnpm("db:migrate");
pnpm("build");

const server = spawn("node", ["--enable-source-maps", "dist/index.js"], {
  cwd: resolve(ROOT, "packages/server"),
  env,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 1));
process.on("exit", () => server.kill());
