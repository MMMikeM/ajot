import { describe, expect, test } from "vite-plus/test";
import { generateKeyBetween } from "fractional-indexing";
import { compareSortOrder, keyAfter, keyBetween } from "@newtab-todo/shared/sort-order";

const isValid = (key: string) => {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
};

describe("compareSortOrder", () => {
  test("puts the key before a0 first, where localeCompare puts it last", () => {
    expect(["a1", "Zz", "a0"].sort(compareSortOrder)).toEqual(["Zz", "a0", "a1"]);
  });

  test("orders mixed-case digits by code unit", () => {
    expect(["a0v", "a0V"].sort(compareSortOrder)).toEqual(["a0V", "a0v"]);
  });

  test("puts no key first", () => {
    expect(["a0", null, "Zz"].sort(compareSortOrder)).toEqual([null, "Zz", "a0"]);
  });
});

describe("keyAfter", () => {
  test("passes over a malformed key that sorts last", () => {
    const key = keyAfter(["a0", "a1", "a10"]);
    expect(key > "a1" && isValid(key)).toBe(true);
  });

  test("starts a list with no valid keys", () => {
    expect(keyAfter([null, "", "a00"])).toBe("a0");
  });
});

describe("keyBetween", () => {
  test("goes between two neighbours", () => {
    const key = keyBetween("a0", "a1");
    expect(key > "a0" && key < "a1").toBe(true);
  });

  test("goes after two equal keys, which leave no room between them", () => {
    const key = keyBetween("a1", "a1");
    expect(key > "a1" && isValid(key)).toBe(true);
  });

  test.each([
    ["a10", "a2"],
    ["", "a2"],
  ])("treats a malformed previous key (%j) as none", (prev, next) => {
    const key = keyBetween(prev, next);
    expect(key < "a2" && isValid(key)).toBe(true);
  });

  test("treats a malformed next key as none", () => {
    const key = keyBetween("a1", "a10");
    expect(key > "a1" && isValid(key)).toBe(true);
  });
});
