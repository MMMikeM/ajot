import { describe, expect, test } from "vite-plus/test";
import { isAllowedOrigin, isCrossOriginWrite, parseAllowedOrigins } from "./origins";

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

  test("one a self-hoster listed, for a proxy that rewrites Host", () => {
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

describe("isCrossOriginWrite", () => {
  const write = {
    origin: "https://evil.example",
    host: "ajot.fly.dev",
    method: "POST",
    secFetchSite: "cross-site",
  };

  test("a write from another site", () => {
    expect(isCrossOriginWrite(write, [])).toBe(true);
    expect(isCrossOriginWrite({ ...write, method: "DELETE" }, [])).toBe(true);
  });

  test("a write with an opaque origin from another site", () => {
    expect(isCrossOriginWrite({ ...write, origin: "null" }, [])).toBe(true);
  });

  test("not a read", () => {
    expect(isCrossOriginWrite({ ...write, method: "GET" }, [])).toBe(false);
    expect(isCrossOriginWrite({ ...write, method: "OPTIONS" }, [])).toBe(false);
  });

  test("not a write from the app or an extension", () => {
    expect(isCrossOriginWrite({ ...write, origin: "https://ajot.fly.dev" }, [])).toBe(false);
    expect(isCrossOriginWrite({ ...write, origin: "chrome-extension://abc" }, [])).toBe(false);
  });

  test("not a request with no Origin, as a script or the cron job sends", () => {
    expect(isCrossOriginWrite({ ...write, origin: undefined }, [])).toBe(false);
  });

  test("not a same-origin write the no-referrer policy sent with Origin: null", () => {
    expect(isCrossOriginWrite({ ...write, origin: "null", secFetchSite: "same-origin" }, [])).toBe(
      false,
    );
  });
});
