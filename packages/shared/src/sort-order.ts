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

const SMALLEST_INTEGER = `A${"0".repeat(26)}`;

/** How long the integer part is, by its head: a to z make 2 to 27 characters, Z to A the same. */
const integerLength = (head: string) =>
  head >= "a" ? head.charCodeAt(0) - 95 : 92 - head.charCodeAt(0);

/**
 * A key fractional-indexing makes, as the database's sort_order CHECK has it: a head letter, the
 * integer part it gives the length of, and a fraction not ending in 0, all base-62 digits.
 * fractional-indexing itself takes any character as a digit.
 */
export const isSortKey = (key: SortKey): key is string => {
  if (!key || !/^[A-Za-z][0-9A-Za-z]*$/.test(key) || key === SMALLEST_INTEGER) return false;
  const length = integerLength(key[0]!);
  return key.length === length || (key.length > length && !key.endsWith("0"));
};

/** A key after every valid one. A malformed key, from an import or an old client, is passed over. */
export const keyAfter = (keys: Iterable<SortKey>) => {
  let last: string | null = null;
  for (const key of keys) if (isSortKey(key) && (last === null || key > last)) last = key;
  return generateKeyBetween(last, null);
};

/**
 * A key between two neighbours. A malformed one counts as no neighbour, and two equal keys leave
 * no room between them, so the key goes after both.
 */
export const keyBetween = (prev: SortKey, next: SortKey) => {
  const after = isSortKey(prev) ? prev : null;
  const before = isSortKey(next) ? next : null;
  if (after !== null && after === before) return generateKeyBetween(after, null);
  return generateKeyBetween(after, before);
};
