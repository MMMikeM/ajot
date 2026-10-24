import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Runs the bundle production runs; a hidden prompt reads the new password
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
    // So dev stack traces point at src/ (the dev script runs node --enable-source-maps)
    sourcemap: true,
    deps: {
      // Workspace package exports .ts sources directly with no build step — force-bundle it
      alwaysBundle: [/^@newtab-todo\/shared(\/|$)/],
      // Native addons and WASM cannot be bundled — must stay in node_modules
      neverBundle: ["@node-rs/argon2"],
    },
  },
});
