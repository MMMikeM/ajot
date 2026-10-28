import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { describe, expect, test } from "vite-plus/test";
import { generateKeyBetween } from "fractional-indexing";
import { compareSortOrder, isSortKey, keyAfter, keyAt } from "@newtab-todo/shared/sort-order";
import { migrate } from "./db/migrator";

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

describe("keyAt", () => {
  test("goes between two neighbours", () => {
    const key = keyAt(["a0", "a1"], 1);
    expect(key > "a0" && key < "a1").toBe(true);
  });

  test("goes first and last", () => {
    expect(keyAt(["a0", "a1"], 0) < "a0").toBe(true);
    expect(keyAt(["a0", "a1"], 2) > "a1").toBe(true);
  });

  test("goes after a tie, and before the row that follows it", () => {
    const key = keyAt(["a0", "a0", "a0V"], 1);
    expect(key > "a0" && key < "a0V" && isValid(key)).toBe(true);
  });

  test("goes after two equal keys with nothing after them", () => {
    const key = keyAt(["a1", "a1"], 1);
    expect(key > "a1" && isValid(key)).toBe(true);
  });

  test.each([
    [["a10", "a2"], 1],
    [["", "a2"], 1],
  ])("passes over a malformed previous key (%j)", (keys, index) => {
    const key = keyAt(keys, index);
    expect(key < "a2" && isValid(key)).toBe(true);
  });

  test("passes over a malformed next key", () => {
    const key = keyAt(["a1", "a10", "a3"], 1);
    expect(key > "a1" && key < "a3" && isValid(key)).toBe(true);
  });
});

describe("isSortKey", () => {
  const keys = {
    valid: ["a0", "a1", "az", "aV", "Zz", "Z0", "b00", "b0V", "a0V", "zzzzzzzzzzzzzzzzzzzzzzzzzzz"],
    malformed: [
      "",
      "a",
      "a00",
      "a10",
      "b0",
      "0a",
      "a!",
      "a0!",
      "a0 ",
      "aé",
      "a0é",
      `A${"0".repeat(26)}`,
    ],
  };
  const all = [...keys.valid, ...keys.malformed];
  const libraryTakes = (key: string) => {
    try {
      generateKeyBetween(key, null);
      return true;
    } catch {
      return false;
    }
  };

  test("takes the keys fractional-indexing makes and refuses the rest", () => {
    expect(keys.valid.filter((key) => !isSortKey(key))).toEqual([]);
    expect(keys.malformed.filter(isSortKey)).toEqual([]);
  });

  test("agrees with fractional-indexing on every base-62 key", () => {
    const base62 = all.filter((key) => /^[0-9A-Za-z]*$/.test(key));
    expect(base62.filter((key) => isSortKey(key) !== libraryTakes(key))).toEqual([]);
  });

  test("agrees with the database's CHECK on every key", async () => {
    const sqlite = new DatabaseSync(":memory:");
    await migrate(
      drizzle({ client: sqlite }),
      fileURLToPath(new URL("../drizzle", import.meta.url)),
    );
    sqlite.exec(
      "INSERT INTO users (id, name, username, password_hash) VALUES ('u', 'U', 'u', 'x')",
    );
    const insert = sqlite.prepare(
      "INSERT INTO tasks (id, user_id, title, sort_order) VALUES (?, 'u', 't', ?)",
    );
    const databaseTakes = (key: string) => {
      try {
        insert.run(key, key);
        return true;
      } catch {
        return false;
      }
    };
    expect(all.filter((key) => isSortKey(key) !== databaseTakes(key))).toEqual([]);
  });
});
