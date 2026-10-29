// First, so its js-start mark is taken before any other module runs
import { markStartup } from "~/lib/startup-timing";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "~/lib/db/query-client";
import { getRouter } from "./router";
import { initSync } from "~/lib/sync/sse";
import { reloadOnStaleChunk } from "~/lib/stale-chunk";
import { paintDesk } from "~/lib/desk";
import "./app.css";

// Firefox 139 and Chrome 144 ship Temporal; elsewhere the polyfill loads before the first render
if (!("Temporal" in globalThis)) await import("temporal-polyfill/global");

markStartup("modules-loaded");
initSync();
reloadOnStaleChunk();
// Once the list is up: creating a GPU context can take tens of milliseconds
(window.requestIdleCallback ?? ((paint: () => void) => setTimeout(paint, 200)))(paintDesk);

console.log(`[build] ${__BUILD_VERSION__}`);

const root = document.getElementById("root")!;
const router = getRouter();
const isPrerendered = root.innerHTML.trim() !== "";

if (isPrerendered) {
  router.ssr = { manifest: undefined };
  await router.load();
  hydrateRoot(
    root,
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
