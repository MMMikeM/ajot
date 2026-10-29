import { randomUUID } from "node:crypto";
import { encodeRfc3986, storage, stagedKey } from "./storage";

// Sets the bucket up for pages and checks what attachments rely on it to enforce. Runs with the
// server's own variables: `node dist/bucket-setup.js` on the machine, e.g. via `fly ssh console`.
if (!storage) {
  console.error(
    "No bucket: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3 and BUCKET_NAME must all be set.",
  );
  process.exit(1);
}
const bucket = storage;

let failures = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail && ` (${detail})`}`);
  if (!ok) failures++;
};

await bucket.allowBrowsers();
check(true, "pages may upload and download with presigned URLs (CORS set)");

const key = stagedKey(`a/setup-check-${randomUUID()}`);
const name = "Café (draft).txt";
const put = (url: string, body: string, contentType = "text/plain") =>
  fetch(url, { method: "PUT", headers: { "content-type": contentType }, body });

try {
  const uploadUrl = await bucket.presignPut(key, 5, "text/plain");
  const overLength = await put(uploadUrl, "hello!");
  check(
    !overLength.ok,
    "a PUT longer than its signed length is refused",
    `answered ${overLength.status}`,
  );
  const otherType = await put(uploadUrl, "hello", "text/html");
  check(
    !otherType.ok,
    "a PUT of another type than it was signed for is refused",
    `answered ${otherType.status}`,
  );
  const exact = await put(uploadUrl, "hello");
  check(exact.ok, "a PUT of exactly what was signed is stored", `answered ${exact.status}`);
  check((await bucket.sizeOf(key)) === 5, "its size reads back");

  const disposition = `attachment; filename*=UTF-8''${encodeRfc3986(name)}`;
  const download = await fetch(await bucket.presignGet(key, disposition));
  check(
    download.ok && (await download.text()) === "hello",
    "a presigned GET downloads it",
    `answered ${download.status}`,
  );
  check(
    download.headers.get("content-disposition") === disposition,
    "the GET is served with the disposition it was signed with",
    download.headers.get("content-disposition") ?? "none",
  );
} finally {
  await bucket.remove(key);
}

if (failures > 0) {
  console.error(
    `${failures} check${failures === 1 ? "" : "s"} failed: attachments shouldn't be turned on with this bucket.`,
  );
  process.exit(1);
}
console.log("The bucket is ready for attachments.");
