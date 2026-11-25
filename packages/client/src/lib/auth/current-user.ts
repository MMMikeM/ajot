import { useSyncExternalStore } from "react";
import { getOrCreateDeviceId } from "~/lib/auth/device-id";
import { getSignedIn, subscribeSignedIn } from "~/lib/auth/signed-in";

const getCurrentUser = () => getSignedIn().user;

export const getCurrentUserId = () => getCurrentUser()?.id ?? getOrCreateDeviceId();
export const getSignedInUserId = () => getCurrentUser()?.id ?? null;

export const useCurrentUser = () => useSyncExternalStore(subscribeSignedIn, getCurrentUser);

export const useCurrentUserId = () => useSyncExternalStore(subscribeSignedIn, getSignedInUserId);

export const useOptimisticUserId = () => useSyncExternalStore(subscribeSignedIn, getCurrentUserId);
