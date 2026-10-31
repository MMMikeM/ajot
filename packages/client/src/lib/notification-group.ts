import type { ShownNotification } from "@newtab-todo/shared/push-payload";

/** Every notification shares this one when they're grouped, so each replaces the last. */
export const GROUP_TAG = "ajot";
/** Where the PWA's Settings saves the choice, for its worker to read on each push. */
export const GROUPED_KEY = "notifications-grouped";

/**
 * `renotify` alerts again when a notification replaces one with its tag. Chromium has it; TypeScript's
 * DOM types leave it out, and Firefox replaces without alerting.
 */
export type ReplacingOptions = NotificationOptions & { renotify?: boolean };

const SHOWN_LINES = 4;

export type Group = { entries: ShownNotification[] };

const lineOf = ({ title, body }: ShownNotification) =>
  title === "Ajot" ? body : `${title}: ${body}`;

/**
 * The one notification standing for everything not yet looked at: the newest first, one line per
 * thing it's about. "Your lists were updated" says nothing the others don't, so it only shows alone.
 */
export const addToGroup = (open: Group | undefined, shown: ShownNotification) => {
  const before = open?.entries ?? [];
  const quiet = shown.tag === "changes";
  const entries =
    quiet && before.length > 0
      ? before
      : [shown, ...before.filter((entry) => entry.tag !== shown.tag && entry.tag !== "changes")];
  const [only] = entries.length === 1 ? entries : [];
  const hidden = entries.length - SHOWN_LINES;
  return {
    title: only?.title ?? `${entries.length} updates`,
    body:
      only?.body ??
      [
        ...entries.slice(0, SHOWN_LINES).map(lineOf),
        ...(hidden > 0 ? [`and ${hidden} more`] : []),
      ].join("\n"),
    url: only?.url ?? "/",
    group: { entries } satisfies Group,
  };
};
