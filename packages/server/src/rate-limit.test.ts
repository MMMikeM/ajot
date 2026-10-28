import { expect, test } from "vite-plus/test";
import { limitedAs } from "./rate-limit";

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
