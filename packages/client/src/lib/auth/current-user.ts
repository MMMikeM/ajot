import { useSyncExternalStore } from "react";
import { nanoid } from "nanoid";
import { USER_ID_KEY } from "@newtab-todo/shared/constants";
import { getBuildTarget } from "~/lib/build-target";
import { ext } from "~/lib/ext";
import { createExternalStore } from "~/lib/external-store";

const ID_KEY = USER_ID_KEY;
const INFO_KEY = "newtab-todo-user-info";
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

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
}

const loadUser = (): CurrentUser | null => {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(INFO_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  const id = localStorage.getItem(ID_KEY);
  return id ? { id, name: "", username: "" } : null;
};

const store = createExternalStore<CurrentUser | null>(loadUser());

export const getCurrentUserId = () => store.get()?.id ?? getOrCreateDeviceId();
export const getSignedInUserId = () => store.get()?.id ?? null;
export const subscribeCurrentUser = store.subscribe;

// The extension's background can't read localStorage, so it gets a copy
const storeUserForBackground = (userId: string | null) => {
  if (getBuildTarget() !== "extension") return;
  const write = userId
    ? ext.storage.local.set({ [USER_ID_KEY]: userId })
    : ext.storage.local.remove(USER_ID_KEY);
  write.catch(console.error);
};

export const shareUserWithBackground = () => storeUserForBackground(getSignedInUserId());

export const setCurrentUser = (user: CurrentUser) => {
  localStorage.setItem(ID_KEY, user.id);
  localStorage.setItem(INFO_KEY, JSON.stringify(user));
  store.set(user);
  storeUserForBackground(user.id);
};

export const clearCurrentUser = () => {
  localStorage.removeItem(ID_KEY);
  localStorage.removeItem(INFO_KEY);
  store.set(null);
  storeUserForBackground(null);
};

export const useCurrentUser = store.useStore;

export const useCurrentUserId = () =>
  useSyncExternalStore(store.subscribe, () => store.get()?.id ?? null);

export const useOptimisticUserId = () =>
  useSyncExternalStore(store.subscribe, () => store.get()?.id ?? getOrCreateDeviceId());
