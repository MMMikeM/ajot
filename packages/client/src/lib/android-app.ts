const KEY = "ajot-android-app";

/**
 * The Android app's package when this page runs inside it, or null. Chrome gives a Trusted Web
 * Activity's first page the app as its referrer (`android-app://<package>/`), so it's kept for the
 * session's later loads.
 */
export const androidAppPackage = (): string | null => {
  const referrer = document.referrer.startsWith("android-app://")
    ? new URL(document.referrer).host
    : null;
  try {
    if (referrer) sessionStorage.setItem(KEY, referrer);
    return referrer ?? sessionStorage.getItem(KEY);
  } catch {
    return referrer;
  }
};

/** Opens the app's own activity that keeps the widget's token, then returns to this page. */
export const handTokenToWidget = (appPackage: string, token: string) => {
  location.href = `intent://connect-widget#Intent;scheme=ajot;package=${appPackage};S.token=${encodeURIComponent(token)};end`;
};
