import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";

/**
 * mockApi answers /api/events with a 204, which closes the stream for good, so the header reads
 * Offline. This server holds it open instead, as the real one does, so the page reads as connected.
 */
export const startEventStream = async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    });
    res.write(": connected\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  return {
    /** Call after mockApi: the route registered last wins for /api/events */
    holdOpen: (page: Page) => page.route("**/api/events**", (route) => route.continue({ url })),
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};
