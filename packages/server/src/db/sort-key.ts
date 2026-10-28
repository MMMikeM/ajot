import { isSortKey } from "@newtab-todo/shared/sort-order";

// Thousands of drops between the same two rows make a key this long; anything longer was sent to
// fill the database
const MAX_SORT_KEY = 1_000;

/**
 * The key to write of one a client sent. The database refuses a malformed key, which only a
 * device still holding a list from before it did can send; leaving it out lets the rest of the
 * change through, where refusing would lose it. A new row without one sorts first.
 */
export const keptSortOrder = (key: string | null | undefined) =>
  key === null || key === undefined || (isSortKey(key) && key.length <= MAX_SORT_KEY)
    ? key
    : undefined;
