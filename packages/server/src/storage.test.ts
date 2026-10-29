import { expect, test } from "vite-plus/test";
import { storageFrom } from "./storage";

const env = {
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
  AWS_ENDPOINT_URL_S3: "https://fly.storage.tigris.dev",
  BUCKET_NAME: "ajot",
};

test("without every variable fly storage create sets, there's no storage", () => {
  for (const name of Object.keys(env))
    expect(storageFrom({ ...env, [name]: undefined }), name).toBeUndefined();
});

test("an upload URL is path-style, lasts 15 minutes and holds the PUT to its size and type", async () => {
  const url = new URL(await storageFrom(env)!.presignPut("a/1", 5, "image/jpeg"));
  expect(`${url.origin}${url.pathname}`).toBe("https://fly.storage.tigris.dev/ajot/a/1");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
});

test("a download URL carries the disposition it was signed with", async () => {
  const url = new URL(await storageFrom(env)!.presignGet("a/1", "attachment"));
  expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
  expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
});
