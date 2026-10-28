import { generateKeyBetween } from "fractional-indexing";

type SortKey = string | null | undefined;

/**
 * The order fractional-indexing keys are made for: by code unit, as the database sorts them.
 * localeCompare puts "Zz", the key before "a0", after it. No key sorts first.
 */
export const compareSortOrder = (a: SortKey, b: SortKey) => {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

const isValidKey = (key: SortKey): key is string => {
  if (!key) return false;
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
};

/** A key after every valid one. A malformed key, from an import or an old client, is passed over. */
export const keyAfter = (keys: Iterable<SortKey>) => {
  let last: string | null = null;
  for (const key of keys) if (isValidKey(key) && (last === null || key > last)) last = key;
  return generateKeyBetween(last, null);
};

/**
 * A key between two neighbours. A malformed one counts as no neighbour, and two equal keys leave
 * no room between them, so the key goes after both.
 */
export const keyBetween = (prev: SortKey, next: SortKey) => {
  const after = isValidKey(prev) ? prev : null;
  const before = isValidKey(next) ? next : null;
  if (after !== null && after === before) return generateKeyBetween(after, null);
  return generateKeyBetween(after, before);
};
