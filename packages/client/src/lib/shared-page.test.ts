import { expect, test } from "vite-plus/test";
import { taskFromShare } from "~/lib/shared-page";

test("Chrome sharing a page: its title, and the address it puts in the text", () => {
  expect(
    taskFromShare({ title: "Local-first software", text: "https://inkandswitch.com/lf/" }),
  ).toEqual({ title: "Local-first software", description: "https://inkandswitch.com/lf/" });
});

test("an app sending the address on its own", () => {
  expect(taskFromShare({ title: "Pull request", url: "https://github.com/x/y/pull/1" })).toEqual({
    title: "Pull request",
    description: "https://github.com/x/y/pull/1",
  });
});

test("shared text with its address after it: the text leads, both are kept", () => {
  expect(
    taskFromShare({ text: "Check the luggage allowance\nbefore booking https://a.test/fares" }),
  ).toEqual({
    title: "Check the luggage allowance",
    description: "Check the luggage allowance\nbefore booking\n\nhttps://a.test/fares",
  });
});

test("only an address: it's the title, not repeated", () => {
  expect(taskFromShare({ text: "https://a.test/x" })).toEqual({
    title: "https://a.test/x",
    description: null,
  });
});

test("a line of text alone is the title and nothing else", () => {
  expect(taskFromShare({ text: "  Buy   oat milk " })).toEqual({
    title: "Buy oat milk",
    description: null,
  });
});

test("a file alone is named for itself, several by their count", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));
  expect(taskFromShare({ files: named("IMG_2031.jpg") })).toEqual({
    title: "IMG_2031.jpg",
    description: null,
  });
  expect(taskFromShare({ files: named("a.pdf", "b.pdf") })?.title).toBe("2 files");
  expect(taskFromShare({ text: "Receipts for May", files: named("a.pdf") })?.title).toBe(
    "Receipts for May",
  );
});

test("nothing shared adds nothing", () => {
  expect(taskFromShare({ title: " ", text: "" })).toBeUndefined();
});
