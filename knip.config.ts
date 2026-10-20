import type { KnipConfig } from "knip";

export default {
  ignore: [
    "packages/e2e/**",
    "packages/client/src/lib/gradients.ts",
    // Vendored Impeccable skill (managed by `npx impeccable update`)
    ".claude/skills/impeccable/**",
  ],
  workspaces: {
    "packages/client": {
      entry: [
        "src/background-firefox.ts",
        "src/background-chrome.ts",
        "src/entry-server.tsx",
        "src/routes/**/*.tsx",
      ],
      project: ["src/**/*.{ts,tsx,css}"],
      // Type-checking runs through Vite+ (tsgolint), so `typescript` is no longer a
      // dependency and knip won't auto-enable this plugin to read compilerOptions.types
      typescript: { config: ["tsconfig.json"] },
    },
    "packages/server": {
      entry: ["src/reset-password.ts"],
      project: ["src/**/*.{ts,tsx}"],
    },
    "packages/shared": {
      project: ["src/**/*.{ts,tsx}"],
    },
  },
  // drizzle.config.ts loads .env.dev, which only exists where db:push runs
  drizzle: false,
  ignoreExportsUsedInFile: true,
  ignoreDependencies: [
    // Vite plugins / build tools — used in config files, not detectable as normal imports
    "@tailwindcss/node", // peer dep of @tailwindcss/vite, invoked internally
    "lightningcss", // Vite CSS pipeline peer dep, version-pinned here
  ],
} satisfies KnipConfig;
