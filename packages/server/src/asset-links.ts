const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * The Digital Asset Links statement that lets the Android app open this server full screen, or
 * nothing when no app is configured. A wrong fingerprint only shows as the app's URL bar, so a
 * malformed one stops the server instead.
 */
export const androidAssetLinks = (env: Record<string, string | undefined>) => {
  const packageName = env.ANDROID_PACKAGE_NAME;
  const fingerprints = (env.ANDROID_SHA256_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter(Boolean);
  if (!packageName || fingerprints.length === 0) return undefined;
  const malformed = fingerprints.filter((f) => !FINGERPRINT.test(f));
  if (malformed.length > 0)
    throw new Error(`ANDROID_SHA256_FINGERPRINTS has a malformed fingerprint: ${malformed.join(", ")}`);
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
};
