import { beforeEach, expect, test, vi } from "vite-plus/test";
import { recordMetric, sendPendingMetrics } from "~/lib/metrics";

const stored: Record<string, unknown> = {};
const answers: number[] = [];
const posted: string[] = [];

vi.mock("~/lib/ext", () => ({
  ext: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => void Object.assign(stored, items),
      },
    },
  },
}));

vi.mock("~/lib/api-client", async (actual) => ({
  ...(await actual<typeof import("~/lib/api-client")>()),
  apiClient: () => ({
    api: {
      metrics: {
        $post: async ({ json }: { json: { name: string } }) => {
          const status = answers.shift() ?? 204;
          if (status === 0) throw new TypeError("Failed to fetch");
          if (status === 204) posted.push(json.name);
          return { ok: status < 400, status, json: async () => ({}) };
        },
      },
    },
  }),
}));

const session = { token: "t", serverUrl: "https://ajot.test", userId: "u1" };
const pending = () => stored["ajot-pending-metrics"];

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  answers.length = 0;
  posted.length = 0;
});

test("counts kept while signed out are sent, in order, once there's a session", async () => {
  await recordMetric("menu-click:page:share", null);
  await recordMetric("menu-fail:page:share:session:signed-out", null);
  expect(posted).toEqual([]);
  await sendPendingMetrics(session);
  expect(posted).toEqual(["menu-click:page:share", "menu-fail:page:share:session:signed-out"]);
  expect(pending()).toEqual([]);
});

test("offline, or with an expired token, counts wait for the next send", async () => {
  answers.push(0);
  await recordMetric("menu-click:page:inbox", session);
  answers.push(401);
  await recordMetric("menu-fail:page:inbox:add:401", session);
  expect(pending()).toEqual(["menu-click:page:inbox", "menu-fail:page:inbox:add:401"]);
  await sendPendingMetrics(session);
  expect(posted).toEqual(["menu-click:page:inbox", "menu-fail:page:inbox:add:401"]);
});

test("a name the server refuses is dropped rather than holding up the rest", async () => {
  answers.push(400);
  await recordMetric("Not A Name", null);
  await recordMetric("menu:page:inbox", session);
  expect(posted).toEqual(["menu:page:inbox"]);
  expect(pending()).toEqual([]);
});

test("clicks recorded at once keep every count", async () => {
  answers.push(0, 0, 0);
  await Promise.all([
    recordMetric("menu-click:link:inbox", session),
    recordMetric("menu-click:page:inbox", session),
  ]);
  expect(pending()).toEqual(["menu-click:link:inbox", "menu-click:page:inbox"]);
});
