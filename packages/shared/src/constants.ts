export const TOKEN_KEY = "newtab-todo-token";
export const SERVER_URL_KEY = "newtab-todo-server-url";
export const USER_ID_KEY = "newtab-todo-user-id";

export const INBOX_COLOR = "oklch(0.90 0.008 80)";

// All work as text on the dark background and as a background with white text
export const CATEGORY_COLORS = [
  { name: "Rust", value: "oklch(0.58 0.17 25)" },
  { name: "Amber", value: "oklch(0.68 0.16 58)" },
  { name: "Gold", value: "oklch(0.74 0.13 85)" },
  { name: "Sage", value: "oklch(0.60 0.12 138)" },
  { name: "Spruce", value: "oklch(0.53 0.10 162)" },
  { name: "Slate", value: "oklch(0.55 0.07 228)" },
  { name: "Mauve", value: "oklch(0.55 0.13 315)" },
  { name: "Blush", value: "oklch(0.61 0.13 4)" },
] as const;
export const EVENTS_PATH = "/api/events";
export const SSE_DATA_CHANGED = "data-changed";
// A notification payload, for the Firefox extension's background, which has no Web Push
export const SSE_NOTIFICATION = "notification";
export const MSG_TOKEN_CHANGED = "TOKEN_CHANGED";
export const MSG_GET_STATUS = "GET_STATUS";
export const MSG_BG_STATUS = "BG_STATUS";
export const MSG_SYNC_ALL = "SYNC_ALL";
/** A page asks the PWA's worker which build it is; the worker answers with the same type. */
export const MSG_BUILD_VERSION = "BUILD_VERSION";

export const MODEL_NAMES = ["tasks", "categories", "notes", "contacts", "attachments"] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export const CATEGORY_TASK_ACTIONS = ["uncategorise", "delete"] as const;
export type CategoryTaskAction = (typeof CATEGORY_TASK_ACTIONS)[number];

export type MutationEvent = {
  model: ModelName;
  action: "insert" | "update" | "delete";
  data: object;
  sourceClientId?: string;
};
