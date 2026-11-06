import { expect, test, vi } from "vite-plus/test";

const created = vi.hoisted(() => [] as { id: string; title?: string; parentId?: string }[]);

vi.mock("~/lib/ext", () => ({
  ext: {
    contextMenus: {
      create: (item: { id: string }) => void created.push(item),
      removeAll: async () => void created.splice(0),
      onClicked: { addListener: () => {} },
    },
    runtime: { onMessage: { addListener: () => {} } },
    storage: { onChanged: { addListener: () => {} } },
  },
  getStoredSession: async () => ({ serverUrl: "https://ajot.test", token: "t", userId: "me" }),
}));
vi.mock("~/lib/metrics", () => ({ recordMetric: () => {}, sendPendingMetrics: () => {} }));
vi.mock("~/lib/api-client", async (actual) => ({
  ...(await actual<typeof import("~/lib/api-client")>()),
  succeeded: async (res: unknown) => res,
  apiClient: () => ({
    api: {
      categories: {
        $get: async () => ({
          json: async () => [{ id: "home", name: "Home", collaborators: [{ userId: "sam" }] }],
        }),
      },
      contacts: {
        $get: async () => ({
          json: async () => [{ contactUser: { id: "sam", username: "sam", name: "Sam" } }],
        }),
      },
    },
  }),
}));

const { setupContextMenu } = await import("./context-menu");

test("every destination is one level into the Ajot menu, in sections", async () => {
  setupContextMenu();
  await vi.waitFor(() => expect(created.length).toBeGreaterThan(0));

  expect(created.filter((item) => item.parentId)).toEqual([]);
  expect(created.map((item) => item.title ?? "—")).toEqual([
    "Add and open in Ajot…",
    "—",
    "Add to",
    "Inbox",
    "Home",
    "—",
    "Share with",
    "Sam",
    "—",
    "Send to",
    "Sam",
  ]);
});
