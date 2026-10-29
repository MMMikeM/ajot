/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "lib-not-to-ui",
      comment: "lib/ is the layer components and routes build on, so it must not import them.",
      severity: "error",
      from: { path: "^packages/client/src/lib/" },
      to: { path: "^packages/client/src/(components|routes)/" },
    },
    {
      name: "ui-calls-actions-not-api",
      comment:
        "Components and routes reach the server through lib/actions.ts and the collections, " +
        "never the API client itself.",
      severity: "error",
      from: { path: "^packages/client/src/(components|routes)/" },
      to: { path: "^packages/client/src/lib/api\\.ts$" },
    },
    {
      name: "background-stays-light",
      comment:
        "Extension backgrounds and the PWA service worker run without a DOM. collections.ts " +
        "opens IndexedDB with a top-level await, and React and TanStack would bloat the worker.",
      severity: "error",
      from: { path: "^packages/client/src/(background-firefox|background-chrome|sw)\\.ts$" },
      to: {
        reachable: true,
        path: ["^packages/client/src/lib/db/", "node_modules/(react|react-dom|@tanstack)/"],
      },
    },
    {
      name: "client-imports-server-types-only",
      comment: "A runtime import would bundle server code into the client and the extension.",
      severity: "error",
      from: { path: "^packages/client/" },
      to: { path: "^packages/server/", dependencyTypesNot: ["type-only"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // typescript < 7 is the default parser; this repo has only TypeScript 7
    parser: "swc",
    webpackConfig: { fileName: ".dependency-cruiser.resolve.cjs" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css"],
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
  },
};
