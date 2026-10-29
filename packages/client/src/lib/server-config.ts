export type ServerConfig = { vapidPublicKey: string; awaitingFirstUser: boolean };

export const normalizeServerUrl = (input: string) => {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/** Also proves the URL is one of these servers: anything else fails here, before signing in. */
export const fetchServerConfig = async (serverUrl: string): Promise<ServerConfig> => {
  const res = await fetch(`${serverUrl}/api/config`);
  if (!res.ok) throw new Error(`No sync server at ${serverUrl}`);
  const config = (await res.json()) as Partial<ServerConfig>;
  if (typeof config.vapidPublicKey !== "string") throw new Error(`No sync server at ${serverUrl}`);
  return { vapidPublicKey: config.vapidPublicKey, awaitingFirstUser: !!config.awaitingFirstUser };
};
