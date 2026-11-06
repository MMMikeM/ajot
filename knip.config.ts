import type { KnipConfig } from "knip";

export default {
  ignore: [
    "packages/e2e/**",
    "packages/client/src/lib/gradients.ts",
    "packages/server/src/db/columns.ts",
    // Run by hand from the before-after skill, so nothing imports them
    ".claude/skills/before-after/scripts/**",
  ],
  workspaces: {
    ".": {
      // Loaded through .dependency-cruiser.cjs options.webpackConfig
      entry: [".dependency-cruiser.resolve.cjs"],
    },
    "packages/client": {
      entry: [
        "src/background-firefox.ts",
        "src/background-chrome.ts",
        "src/entry-server.tsx",
        // build-extension.ts builds it from popup.html
        "src/popup.tsx",
        "src/routes/**/*.tsx",
      ],
      project: ["src/**/*.{ts,tsx,css}"],
      // Type-checking runs through Vite+ (tsgolint), so `typescript` isn't a dependency
      // and knip won't auto-enable this plugin to read compilerOptions.types
      typescript: { config: ["tsconfig.json"] },
    },
    "packages/server": {
      // The pack block in vite.config.ts bundles these, which knip doesn't read
      entry: ["src/index.ts", "src/reset-password.ts", "src/bucket-setup.ts"],
      project: ["src/**/*.{ts,tsx}"],
      // package.json exports the repos the client takes types from, which makes them entry files,
      // whose unused exports knip otherwise skips
      includeEntryExports: true,
    },
    "packages/shared": {
      project: ["src/**/*.{ts,tsx}"],
    },
  },
  // drizzle.config.ts loads .env.dev, which only exists where migrations are made
  drizzle: false,
  ignoreExportsUsedInFile: true,
  ignoreDependencies: [
    "@tailwindcss/node", // peer dep of @tailwindcss/vite, invoked internally
    "lightningcss", // Vite CSS pipeline peer dep, version-pinned here
    "@swc/core", // dependency-cruiser's TypeScript parser (options.parser), loaded at runtime
  ],
  // db:rehearse drives the turso CLI, which whoever rehearses installs and signs in to
  ignoreBinaries: ["turso"],
} satisfies KnipConfig;
