import { z } from "@hono/zod-openapi";
import { expect, test } from "vite-plus/test";
import { MAX_TEXT } from "@newtab-todo/shared/field-limits";
import { limited } from "./field-limits";

const note = limited("A note", MAX_TEXT)(z.string());

test("counts characters as the database's CHECK does, so a row it holds can be saved again", () => {
  expect(note.safeParse("😀".repeat(MAX_TEXT)).success).toBe(true);
});

test("refuses one character past the limit, saying how long it may be", () => {
  const result = note.safeParse("😀".repeat(MAX_TEXT + 1));
  expect(result.error?.issues[0]?.message).toBe("A note can be at most 50,000 characters.");
});
