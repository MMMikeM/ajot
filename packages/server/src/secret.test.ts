import { expect, test } from "vite-plus/test";
import { isSecret } from "./secret";

test.each([
  ["the secret", "the secret", true],
  ["the secreT", "the secret", false],
  ["the", "the secret", false],
  ["", "the secret", false],
  [undefined, "the secret", false],
  ["anything", undefined, false],
  ["", "", false],
])("%j against %j is %s", (given, secret, matches) => {
  expect(isSecret(given, secret)).toBe(matches);
});
