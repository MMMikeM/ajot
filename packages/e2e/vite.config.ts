import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // The prerendered skeleton only exists in a production build
      "test:prerender": {
        command: "playwright test -c playwright.prerender.config.ts",
        dependsOn: ["@newtab-todo/client#build"],
        cache: false,
      },
    },
  },
});
