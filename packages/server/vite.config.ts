import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Runs the bundle production runs
      "reset-password": {
        command: "node --env-file=../../.env dist/reset-password.js",
        dependsOn: ["build"],
        cache: false,
      },
    },
  },
  pack: {
    entry: { index: "src/index.ts", "reset-password": "src/reset-password.ts" },
    format: ["esm"],
    platform: "node",
    target: "node24",
    clean: true,
    // Keep dist/index.js (start script + Dockerfile CMD); tsdown defaults to .mjs on node
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    deps: {
      // Workspace package exports .ts sources directly with no build step
      alwaysBundle: [/^@newtab-todo\/shared(\/|$)/],
      // Native addons and WASM cannot be bundled
      neverBundle: ["@node-rs/argon2"],
    },
  },
});
