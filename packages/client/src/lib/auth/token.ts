import { useSyncExternalStore } from "react";
import { getSignedIn, subscribeSignedIn } from "~/lib/auth/signed-in";

export const getAuthToken = () => getSignedIn().token;

/** Called once the user has changed too, so a listener never sees one without the other. */
export const subscribeAuthToken = subscribeSignedIn;

export const useAuthToken = () => useSyncExternalStore(subscribeSignedIn, getAuthToken);
