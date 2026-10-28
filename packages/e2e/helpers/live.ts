import { expect, type Page, type Request } from "@playwright/test";

type Heard = { event: string; id: unknown };

/**
 * What a page hears on its event stream, from the lines `client/src/lib/sync/sse.ts` logs. An
 * event the page can't apply makes it refetch everything, which would show the change anyway, so
 * `assertAllApplied` fails on one.
 */
export const listenLive = (page: Page) => {
  const heard: Heard[] = [];
  const rejected: string[] = [];
  let streamOpen = false;
  let tasksFetchedSinceOpen = false;
  // A fetch of the lists still in flight would overwrite what arrives live. The page fetches them
  // when its stream opens, and one it started just before stands in for that fetch.
  const inFlight = new Set<Request>();
  const isListFetch = (req: Request) =>
    req.method() === "GET" &&
    /^\/api\/(tasks|categories|notes|contacts)$/.test(new URL(req.url()).pathname);

  page.on("console", async (msg) => {
    const text = msg.text();
    if (text.startsWith("[sse] write rejected")) rejected.push(text);
    if (!text.startsWith("[sse] received ")) return;
    const [, dataArg] = msg.args();
    const data: { id?: unknown } | undefined = await dataArg?.jsonValue().catch(() => undefined);
    heard.push({ event: text.split(" ")[2]!, id: data?.id });
  });
  page.on("request", (req) => {
    if (isListFetch(req)) inFlight.add(req);
  });
  page.on("response", (res) => {
    if (new URL(res.url()).pathname === "/api/events") streamOpen = true;
  });
  const settled = (req: Request) => {
    if (!inFlight.delete(req)) return;
    if (streamOpen && new URL(req.url()).pathname === "/api/tasks") tasksFetchedSinceOpen = true;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);

  return {
    /**
     * Loads `path`, then waits for the stream to open and the page's fetches of the lists to be
     * back, so a change made after this can only reach the page live.
     */
    open: async (path = "/") => {
      streamOpen = false;
      tasksFetchedSinceOpen = false;
      inFlight.clear();
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect
        .poll(() => tasksFetchedSinceOpen && inFlight.size === 0, { timeout: 15_000 })
        .toBe(true);
    },
    /** `event` is `<model>.<action>`, as in `tasks.delete`. */
    expectHeard: (event: string, id: string) =>
      expect.poll(() => heard.some((h) => h.event === event && h.id === id)).toBe(true),
    assertAllApplied: () => expect(rejected).toEqual([]),
  };
};
