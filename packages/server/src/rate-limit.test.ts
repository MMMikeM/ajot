import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { limitableIp, limitedAs } from "./rate-limit";

test.each([
  ["203.0.113.7", "203.0.113.7"],
  ["::ffff:203.0.113.7", "203.0.113.7"],
  ["2001:db8:85a3:12:8a2e:370:7334:1", "2001:db8:85a3:12::/64"],
  ["2001:db8:85a3:12::1", "2001:db8:85a3:12::/64"],
  ["2001:0db8:85a3:0012:ffff::9", "2001:db8:85a3:12::/64"],
  ["2001:db8::1", "2001:db8:0:0::/64"],
  ["2001:DB8::", "2001:db8:0:0::/64"],
  ["fe80::1%eth0", "fe80:0:0:0::/64"],
])("%s is limited as %s", (address, key) => {
  expect(limitedAs(address)).toBe(key);
});

describe("who a request is limited as", () => {
  const app = new Hono().get("/", (c) => c.text(limitableIp(c) ?? "no one"));
  const limitedFrom = async (peer: string, headers: Record<string, string> = {}) =>
    (await app.request("/", { headers }, { incoming: { socket: { remoteAddress: peer } } })).text();
  afterEach(() => vi.unstubAllEnvs());

  test("a client reaching the server itself, whatever it says it forwards", async () => {
    expect(await limitedFrom("203.0.113.7", { "X-Forwarded-For": "198.51.100.1" })).toBe(
      "203.0.113.7",
    );
  });

  test.each(["127.0.0.1", "::1", "172.17.0.1", "10.0.0.2", "192.168.1.1", "::ffff:172.17.0.1"])(
    "behind a proxy at %s, the address the proxy added last",
    async (proxy) => {
      expect(await limitedFrom(proxy, { "X-Forwarded-For": "198.51.100.1, 203.0.113.7" })).toBe(
        "203.0.113.7",
      );
      expect(await limitedFrom(proxy, { "X-Forwarded-For": "203.0.113.8" })).toBe("203.0.113.8");
    },
  );

  test.each(["fd12:3456:789a::1", "fe80::1", "169.254.0.5", "172.31.255.1"])(
    "behind a proxy at %s, on a private or link-local network, too",
    async (proxy) => {
      expect(await limitedFrom(proxy, { "X-Forwarded-For": "2001:db8::9" })).toBe(
        "2001:db8:0:0::/64",
      );
    },
  );

  test.each(["172.32.0.1", "fc0::1", "11.0.0.1"])(
    "%s isn't a private address, so what it forwards is ignored",
    async (peer) => {
      expect(await limitedFrom(peer, { "X-Forwarded-For": "203.0.113.7" })).not.toBe("203.0.113.7");
    },
  );

  test.each([
    ["no forwarded address", {}],
    ["a forwarded address that isn't one", { "X-Forwarded-For": "203.0.113.7, unknown" }],
    ["a forwarded loopback address, from a second proxy", { "X-Forwarded-For": "127.0.0.1" }],
  ])("from a proxy, with %s, no address to limit by", async (_, headers) => {
    expect(await limitedFrom("172.17.0.1", headers)).toBe("no one");
  });

  test("on Fly, the address its proxy set", async () => {
    vi.stubEnv("FLY_APP_NAME", "ajot");
    expect(
      await limitedFrom("172.16.5.2", {
        "Fly-Client-IP": "203.0.113.7",
        "X-Forwarded-For": "198.51.100.1",
      }),
    ).toBe("203.0.113.7");
  });
});
