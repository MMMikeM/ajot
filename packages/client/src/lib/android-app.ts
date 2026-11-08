import { approveWidgetCode } from "~/lib/actions";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";

const PACKAGE_KEY = "ajot-android-app";
const CODE_KEY = "ajot-widget-code";
const PLACED_KEY = "ajot-widget-placed";

// What the app's launcher (android/…/LauncherActivity.kt) puts in the address it opens
const CODE_PARAM = "ajot-widget-code";
const PLACED_PARAM = "ajot-widget";

const session = {
  get: (key: string) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Private mode: the widget asks again on its next tap
    }
  },
  remove: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // As above
    }
  },
};

/**
 * The Android app's package when this page runs inside it, or null. Chrome gives a Trusted Web
 * Activity's first page the app as its referrer (`android-app://<package>/`), so it's kept for the
 * session's later loads.
 */
export const androidAppPackage = (): string | null => {
  const referrer = document.referrer.startsWith("android-app://")
    ? new URL(document.referrer).host
    : null;
  if (referrer) session.set(PACKAGE_KEY, referrer);
  return referrer ?? session.get(PACKAGE_KEY);
};

/** Whether the app said, when it opened this page, that its widget is on the home screen. */
export const widgetIsPlaced = () => session.get(PLACED_KEY) === "1";

const takeLaunchParams = () => {
  const url = new URL(location.href);
  const code = url.searchParams.get(CODE_PARAM);
  const placed = url.searchParams.get(PLACED_PARAM) === "placed";
  if (!code && !placed) return;
  if (code) session.set(CODE_KEY, code);
  if (placed) session.set(PLACED_KEY, "1");
  url.searchParams.delete(CODE_PARAM);
  url.searchParams.delete(PLACED_PARAM);
  history.replaceState(history.state, "", url);
};

const approveKeptCode = () => {
  const code = session.get(CODE_KEY);
  if (!code || !getAuthToken()) return;
  approveWidgetCode(code)
    .then(() => session.remove(CODE_KEY))
    .catch((err) => console.error("[widget] couldn't approve its code:", err));
};

/**
 * Keeps what the app's launcher sent, takes it out of the address, and signs the widget in with
 * this page's session once there is one: after sign-in, if need be. Before the router starts.
 */
export const startWidgetSignIn = () => {
  takeLaunchParams();
  if (!session.get(CODE_KEY)) return;
  approveKeptCode();
  subscribeAuthToken(approveKeptCode);
};

const newCode = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

/**
 * Asks Android to place the widget, already signed in: the code is approved here, and the app
 * claims the widget's token with it.
 */
export const addWidgetToHomeScreen = async (appPackage: string) => {
  const code = newCode();
  await approveWidgetCode(code);
  location.href = `intent://add-widget#Intent;scheme=ajot;package=${appPackage};S.code=${code};end`;
};
