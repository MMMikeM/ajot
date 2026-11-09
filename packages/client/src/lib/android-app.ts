import { approveWidgetCode } from "~/lib/actions";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { fetchServerConfig } from "~/lib/server-config";
import { getServerUrl } from "~/lib/server-url";

const LAUNCHED_BY_KEY = "ajot-android-app";
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

/** The package Chrome names as a Trusted Web Activity's opener, on the load it launched. */
const launchingPackage = () =>
  document.referrer.startsWith("android-app://") ? new URL(document.referrer).host : null;

/**
 * The Android app's package when this page runs inside it, or null. Only the server's own app
 * counts: the referrer names whichever app opened Chrome, and a code or the Settings row handed to
 * another one would sign this account in there.
 */
export const androidAppPackage = async (): Promise<string | null> => {
  const opener = session.get(LAUNCHED_BY_KEY);
  if (!opener) return null;
  const { androidPackage } = await fetchServerConfig(getServerUrl());
  return androidPackage === opener ? opener : null;
};

/** Whether the app said, when it opened this page, that its widget is on the home screen. */
export const widgetIsPlaced = () => session.get(PLACED_KEY) === "1";

// A code in any other address is a link someone sent, and approving it would hand them a token
const takeLaunchParams = () => {
  const url = new URL(location.href);
  const opener = launchingPackage();
  if (opener) {
    session.set(LAUNCHED_BY_KEY, opener);
    // Each launch says afresh, so a widget removed since the last one shows Settings' row again
    if (url.searchParams.get(PLACED_PARAM) === "placed") session.set(PLACED_KEY, "1");
    else session.remove(PLACED_KEY);
    const code = url.searchParams.get(CODE_PARAM);
    if (code) session.set(CODE_KEY, code);
    else session.remove(CODE_KEY);
  }
  if (!url.searchParams.has(CODE_PARAM) && !url.searchParams.has(PLACED_PARAM)) return;
  url.searchParams.delete(CODE_PARAM);
  url.searchParams.delete(PLACED_PARAM);
  history.replaceState(history.state, "", url);
};

const approveKeptCode = async () => {
  const code = session.get(CODE_KEY);
  if (!code || !getAuthToken()) return;
  if (!(await androidAppPackage())) {
    session.remove(CODE_KEY);
    return;
  }
  await approveWidgetCode(code);
  session.remove(CODE_KEY);
};

/**
 * Keeps what the app's launcher sent, takes it out of the address, and signs the widget in with
 * this page's session once there is one: after sign-in, if need be. Before the router starts.
 */
export const startWidgetSignIn = () => {
  takeLaunchParams();
  if (!session.get(CODE_KEY)) return;
  const approve = () =>
    approveKeptCode().catch((err) => console.error("[widget] couldn't approve its code:", err));
  void approve();
  subscribeAuthToken(() => void approve());
};

/**
 * Asks Android to place the widget. It signs in on its first tap, through the launcher's code:
 * a code passed here would let any page that can open the app's intent pick the account.
 */
export const addWidgetToHomeScreen = (appPackage: string) => {
  location.href = `intent://add-widget#Intent;scheme=ajot;package=${appPackage};end`;
};
