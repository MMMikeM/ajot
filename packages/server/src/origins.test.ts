import { describe, expect, test } from "vite-plus/test";
import { isAllowedOrigin, parseAllowedOrigins } from "./origins";

describe("isAllowedOrigin", () => {
  test("the extensions", () => {
    expect(isAllowedOrigin("chrome-extension://abcdefghijklmnop", [])).toBe(true);
    expect(isAllowedOrigin("moz-extension://1234-5678", [])).toBe(true);
  });

  test("not another site", () => {
    expect(isAllowedOrigin("https://evil.example", [])).toBe(false);
    expect(isAllowedOrigin("https://ajot.fly.dev.evil.example", [])).toBe(false);
  });

  test("not an opaque origin", () => {
    expect(isAllowedOrigin("null", [])).toBe(false);
  });

  test("a web app on another address that a self-hoster listed", () => {
    const allowed = parseAllowedOrigins("https://todo.example.com");
    expect(isAllowedOrigin("https://todo.example.com", allowed)).toBe(true);
    expect(isAllowedOrigin("https://other.example.com", allowed)).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  test("trims entries and drops paths", () => {
    expect(parseAllowedOrigins(" https://a.example/ , http://b.example:8080/app")).toEqual([
      "https://a.example",
      "http://b.example:8080",
    ]);
  });

  test("nothing set allows nothing extra", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  test("skips entries whose origin would be opaque", () => {
    expect(parseAllowedOrigins("not a url,file:///x,custom://host")).toEqual([]);
  });
});
