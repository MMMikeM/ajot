import { describe, expect, test } from "vite-plus/test";
import { isAllowedOrigin, parseAllowedOrigins } from "./origins";

describe("isAllowedOrigin", () => {
  test("the server's own origin, though TLS ended at the proxy", () => {
    expect(isAllowedOrigin("https://ajot.fly.dev", "ajot.fly.dev", [])).toBe(true);
  });

  test("the same host and port over plain http", () => {
    expect(isAllowedOrigin("http://localhost:5180", "localhost:5180", [])).toBe(true);
  });

  test("not the same host on another port", () => {
    expect(isAllowedOrigin("http://localhost:5181", "localhost:5180", [])).toBe(false);
  });

  test("the extensions", () => {
    expect(isAllowedOrigin("chrome-extension://abcdefghijklmnop", "ajot.fly.dev", [])).toBe(true);
    expect(isAllowedOrigin("moz-extension://1234-5678", "ajot.fly.dev", [])).toBe(true);
  });

  test("not another site", () => {
    expect(isAllowedOrigin("https://evil.example", "ajot.fly.dev", [])).toBe(false);
    expect(isAllowedOrigin("https://ajot.fly.dev.evil.example", "ajot.fly.dev", [])).toBe(false);
  });

  test("not an opaque origin", () => {
    expect(isAllowedOrigin("null", "ajot.fly.dev", [])).toBe(false);
    expect(isAllowedOrigin("null", undefined, [])).toBe(false);
  });

  test("a web app on another address that a self-hoster listed", () => {
    const allowed = parseAllowedOrigins("https://todo.example.com");
    expect(isAllowedOrigin("https://todo.example.com", "127.0.0.1:3000", allowed)).toBe(true);
    expect(isAllowedOrigin("https://other.example.com", "127.0.0.1:3000", allowed)).toBe(false);
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
