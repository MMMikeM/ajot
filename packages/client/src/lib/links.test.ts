import { expect, test } from "vite-plus/test";
import { linksIn } from "~/lib/links";

test("a page added from the menu: its address, labelled without the scheme", () => {
  expect(linksIn("https://github.com/MMMikeM/ajot/pull/42")).toEqual([
    { href: "https://github.com/MMMikeM/ajot/pull/42", label: "github.com/MMMikeM/ajot/pull/42" },
  ]);
});

test("a selection's text, then the page", () => {
  const text = "Read this before Friday, it's long.\n\nhttps://example.com/";
  expect(linksIn(text)).toEqual([{ href: "https://example.com/", label: "example.com" }]);
});

test("the sentence around an address isn't part of it", () => {
  const text = "See https://a.test/x. Or (https://b.test/y), or “https://c.test/z?q=1#top”!";
  expect(linksIn(text).map((link) => link.href)).toEqual([
    "https://a.test/x",
    "https://b.test/y",
    "https://c.test/z?q=1#top",
  ]);
});

test("brackets that are part of the address stay", () => {
  expect(linksIn("(https://en.wikipedia.org/wiki/Fly_(app))")).toEqual([
    { href: "https://en.wikipedia.org/wiki/Fly_(app)", label: "en.wikipedia.org/wiki/Fly_(app)" },
  ]);
});

test("a label reads in the address's own letters", () => {
  expect(linksIn("https://de.wikipedia.org/wiki/Straße")[0]?.label).toBe(
    "de.wikipedia.org/wiki/Straße",
  );
});

test("only web addresses, each once", () => {
  const text = "javascript:alert(1) ftp://x.test http://a.test http://a.test www.b.test";
  expect(linksIn(text).map((link) => link.href)).toEqual(["http://a.test/"]);
});
