import { isSortKey } from "@newtab-todo/shared/sort-order";

/**
 * The database refuses a malformed key, which only a device still holding a list from before it
 * did can send; leaving it out lets the rest of the change through, where refusing would lose it.
 * A new row without one sorts first.
 */
export const keptSortOrder = (key: string | null | undefined) =>
  key === null || key === undefined || isSortKey(key) ? key : undefined;
