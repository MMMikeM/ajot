import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import { getSignedIn, subscribeSignedIn } from "~/lib/auth/signed-in";

const DEVICE_ID_KEY = "newtab-todo-device-id";

export const getOrCreateDeviceId = (): string => {
  if (typeof localStorage === "undefined") return "";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device-${nanoid()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

const getCurrentUser = () => getSignedIn().user;

export const getCurrentUserId = () => getCurrentUser()?.id ?? getOrCreateDeviceId();
export const getSignedInUserId = () => getCurrentUser()?.id ?? null;

export const useCurrentUser = () => useSyncExternalStore(subscribeSignedIn, getCurrentUser);

export const useCurrentUserId = () => useSyncExternalStore(subscribeSignedIn, getSignedInUserId);

export const useOptimisticUserId = () => useSyncExternalStore(subscribeSignedIn, getCurrentUserId);
