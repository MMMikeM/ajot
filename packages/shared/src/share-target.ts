/** The text the PWA's share target takes, named the same in its manifest, worker and server. */
export const SHARED_TEXT_FIELDS = ["title", "text", "url"] as const;

export type SharedText = Partial<Record<(typeof SHARED_TEXT_FIELDS)[number], string>>;
