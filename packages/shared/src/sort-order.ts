import { generateKeyBetween } from "fractional-indexing";
import { MAX_SORT_KEY } from "@newtab-todo/shared/field-limits";

type SortKey = string | null | undefined;

/**
 * By code unit, as the database sorts them: localeCompare puts "Zz", the key before "a0",
 * after it.
 */
export const compareSortOrder = (a: SortKey, b: SortKey) => {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
};

const SMALLEST_INTEGER = `A${"0".repeat(26)}`;

/** a to z make 2 to 27 characters, Z to A the same. */
const integerLength = (head: string) =>
  head >= "a" ? head.charCodeAt(0) - 95 : 92 - head.charCodeAt(0);

/**
 * A key fractional-indexing makes, as the database's sort_order CHECK has it: a head letter, the
 * integer part it gives the length of, and a fraction not ending in 0, all base-62 digits, at most
 * MAX_SORT_KEY long. fractional-indexing itself takes any character as a digit.
 */
export const isSortKey = (key: SortKey): key is string => {
  if (!key || key.length > MAX_SORT_KEY) return false;
  if (!/^[A-Za-z][0-9A-Za-z]*$/.test(key) || key === SMALLEST_INTEGER) return false;
  const length = integerLength(key[0]!);
  return key.length === length || (key.length > length && !key.endsWith("0"));
};

/** A malformed key, from an import or an old client, is passed over. */
export const keyAfter = (keys: Iterable<SortKey>) => {
  let last: string | null = null;
  for (const key of keys) if (isSortKey(key) && (last === null || key > last)) last = key;
  return generateKeyBetween(last, null);
};

/**
 * The key for a row dropped at `index` among its siblings' keys, in order and without the row.
 * Equal keys leave no room between them, so it goes after the tie rather than past the rows that
 * follow it.
 */
export const keyAt = (keys: readonly SortKey[], index: number) => {
  const after = keys.slice(0, index).filter(isSortKey).at(-1) ?? null;
  const before =
    keys.slice(index).find((key) => isSortKey(key) && (after === null || key > after)) ?? null;
  return generateKeyBetween(after, before);
};
