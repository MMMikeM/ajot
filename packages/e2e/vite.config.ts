import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Both serve the client's production build
      test: {
        command: "playwright test",
        dependsOn: ["@newtab-todo/client#build"],
        cache: false,
      },
      "test:ui": {
        command: "playwright test --ui",
        dependsOn: ["@newtab-todo/client#build"],
        cache: false,
      },
      // The prerendered skeleton only exists in a production build
      "test:prerender": {
        command: "playwright test -c playwright.prerender.config.ts",
        dependsOn: ["@newtab-todo/client#build"],
        cache: false,
      },
      // build:ext builds the client first, so this has the PWA build too
      "test:background": {
        command: "playwright test -c playwright.background.config.ts",
        dependsOn: ["@newtab-todo/client#build:ext"],
        cache: false,
      },
    },
  },
});
