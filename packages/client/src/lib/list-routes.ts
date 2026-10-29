import type { ApiClient, Reply } from "~/lib/api-client";
import type { SNAPSHOT_KEYS } from "~/lib/snapshot-store";

export type ListKey = (typeof SNAPSHOT_KEYS)[number];

/** Where each saved list comes from: the page's collections and the backgrounds' prewarm alike. */
export const listRoutes = ({ api }: ApiClient) =>
  ({
    tasks: () => api.tasks.$get(),
    categories: () => api.categories.$get(),
    notes: () => api.notes.$get(),
    contacts: () => api.contacts.$get(),
    attachments: () => api.attachments.$get(),
  }) satisfies Record<ListKey, () => Promise<Reply>>;
