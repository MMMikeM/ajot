import { expect, test } from "vite-plus/test";
import { androidAssetLinks } from "./asset-links";

const KEY = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join(":");

test("names the app's package and signing key, in the case Chrome compares", () => {
  const [statement] = androidAssetLinks({
    ANDROID_PACKAGE_NAME: "app.ajot",
    ANDROID_SHA256_FINGERPRINTS: ` ${KEY} `,
  })!;
  expect(statement!.target).toEqual({
    namespace: "android_app",
    package_name: "app.ajot",
    sha256_cert_fingerprints: [KEY.toUpperCase()],
  });
});

test("a server with no Android app links none", () => {
  expect(androidAssetLinks({ ANDROID_PACKAGE_NAME: "app.ajot" })).toBeUndefined();
});

test("a malformed fingerprint stops the server rather than showing a URL bar", () => {
  expect(() =>
    androidAssetLinks({ ANDROID_PACKAGE_NAME: "app.ajot", ANDROID_SHA256_FINGERPRINTS: "AB:CD" }),
  ).toThrow(/malformed/);
});
