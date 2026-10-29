import { apiClient } from "~/lib/api-client";

export type AttachmentsConfig = { maxBytes: number };

export type ServerConfig = {
  vapidPublicKey: string;
  awaitingFirstUser: boolean;
  /** Null when the server has no bucket, or is from before attachments. */
  attachments: AttachmentsConfig | null;
};

export const normalizeServerUrl = (input: string) => {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const attachmentsOf = (value: unknown): AttachmentsConfig | null => {
  const maxBytes = (value as Partial<AttachmentsConfig> | null)?.maxBytes;
  return typeof maxBytes === "number" ? { maxBytes } : null;
};

/** Also proves the URL is one of these servers: anything else fails here, before signing in. */
export const fetchServerConfig = async (serverUrl: string): Promise<ServerConfig> => {
  const res = await apiClient({ serverUrl }).api.config.$get();
  if (!res.ok) throw new Error(`No sync server at ${serverUrl}`);
  const config = (await res.json()) as Partial<ServerConfig>;
  if (typeof config.vapidPublicKey !== "string") throw new Error(`No sync server at ${serverUrl}`);
  return {
    vapidPublicKey: config.vapidPublicKey,
    awaitingFirstUser: !!config.awaitingFirstUser,
    attachments: attachmentsOf(config.attachments),
  };
};
