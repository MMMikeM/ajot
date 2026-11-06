import { expect, test } from "vite-plus/test";
import { shareIdIn, taskFromShare } from "~/lib/shared-page";

test("Chrome sharing a page: its title, and the address it puts in the text", () => {
  expect(
    taskFromShare({ title: "Local-first software", text: "https://inkandswitch.com/lf/" }),
  ).toEqual({ title: "Local-first software", description: "https://inkandswitch.com/lf/" });
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

test("the share page's own share, in the PWA's path and in an extension's hash", () => {
  expect(shareIdIn(new URL("https://ajot.test/share?id=a1"), false)).toBe("a1");
  expect(shareIdIn(new URL("chrome-extension://x/index.html#/share?id=a1"), true)).toBe("a1");
  expect(shareIdIn(new URL("https://ajot.test/?id=a1"), false)).toBeNull();
});
