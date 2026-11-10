/** Someone a task can be shared with as it's added: one of your contacts. */
export type Taggable = { id: string; name: string; username: string };

export const MAX_SUGGESTIONS = 6;

/**
 * The `@word` the caret is in, if any. Only at the start of a word, so an address such as
 * sam@example.com doesn't open the picker.
 */
export const mentionAt = (value: string, caret: number) => {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query: query.toLowerCase() };
};

/** By username, or by the start of any word of their name. */
export const suggestionsFor = (
  people: readonly Taggable[],
  query: string,
  picked: readonly Taggable[],
) =>
  people
    .filter(
      (person) =>
        !picked.some((p) => p.id === person.id) &&
        (person.username.toLowerCase().startsWith(query) ||
          person.name
            .toLowerCase()
            .split(/\s+/)
            .some((word) => word.startsWith(query))),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS);

/** The text with the `@word` taken out, and where the caret goes. */
export const withoutMention = (value: string, start: number, caret: number) => {
  const before = value.slice(0, start).trimEnd();
  const after = value.slice(caret).trimStart();
  const joined = before ? `${before} ${after}` : after;
  return { value: joined, caret: before ? before.length + 1 : 0 };
};
