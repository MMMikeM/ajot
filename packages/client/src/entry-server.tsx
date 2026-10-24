import { renderToString } from "react-dom/server";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "~/lib/db/query-client";
import { getRouter } from "./router";

// getBuildTarget() returns "server" in Node.js, so getRouter() creates a memoryHistory at "/".
//
// Only the root chrome renders: the header, the SyncSettings fallback and the task list skeleton.
// The root route keeps the Outlet behind ClientOnly, since routes read localStorage-backed stores.
// collections.ts guards its OPFS init so it doesn't crash when imported in Node.js.
export const render = async (): Promise<string> => {
  const router = getRouter();
  await router.load();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};
