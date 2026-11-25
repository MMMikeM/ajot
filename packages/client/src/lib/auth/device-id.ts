import { nanoid } from "nanoid";

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
