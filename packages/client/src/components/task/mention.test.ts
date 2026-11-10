import { describe, expect, test } from "vite-plus/test";
import { mentionAt, suggestionsFor, withoutMention } from "./mention";

const sarah = { id: "s", name: "Sarah Murray", username: "sarah" };
const sam = { id: "m", name: "Sam Okafor", username: "sokafor" };

describe("the @word being typed", () => {
  test("starts a word", () => {
    expect(mentionAt("Call @sa", 8)).toEqual({ start: 5, query: "sa" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  test("isn't part of an address or past a space", () => {
    expect(mentionAt("mail sam@example.com", 20)).toBeNull();
    expect(mentionAt("Call @sam about it", 18)).toBeNull();
  });
});

test("suggests by username or any word of the name, leaving out who's picked", () => {
  expect(suggestionsFor([sarah, sam], "sa", [])).toEqual([sam, sarah]);
  expect(suggestionsFor([sarah, sam], "oka", [])).toEqual([sam]);
  expect(suggestionsFor([sarah, sam], "so", [])).toEqual([sam]);
  expect(suggestionsFor([sarah, sam], "", [sarah])).toEqual([sam]);
});

test("taking out the @word leaves one space between what's around it", () => {
  expect(withoutMention("Call @sa about it", 5, 8)).toEqual({ value: "Call about it", caret: 5 });
  expect(withoutMention("@sa", 0, 3)).toEqual({ value: "", caret: 0 });
  expect(withoutMention("Call @sa", 5, 8)).toEqual({ value: "Call ", caret: 5 });
});
