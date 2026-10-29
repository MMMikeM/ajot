import { createExternalStore } from "~/lib/external-store";
import { fetchServerConfig, type AttachmentsConfig } from "~/lib/server-config";
import { getServerUrl } from "~/lib/server-url";

const KEY = "ajot-attachments";

type Saved = AttachmentsConfig & { serverUrl: string };

// The server's last answer, so the Attach line shows offline; another server's says nothing
const load = (): AttachmentsConfig | null => {
  if (typeof localStorage === "undefined") return null;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null;
    return saved && saved.serverUrl === getServerUrl() ? { maxBytes: saved.maxBytes } : null;
  } catch {
    return null;
  }
};

const store = createExternalStore(load());

/** Null when the server has no bucket, or this device has never heard from it. */
export const useAttachmentsConfig = store.useStore;

export const refreshAttachmentsConfig = async () => {
  const { attachments } = await fetchServerConfig(getServerUrl());
  if (attachments)
    localStorage.setItem(KEY, JSON.stringify({ ...attachments, serverUrl: getServerUrl() }));
  else localStorage.removeItem(KEY);
  if (attachments?.maxBytes !== store.get()?.maxBytes) store.set(attachments);
};
