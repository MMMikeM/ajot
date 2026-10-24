import { defineConfig, loadEnv, searchForWorkspaceRoot } from "vite-plus";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { injectFontPreloads } from "./plugins/inject-font-preloads";
import { prerender } from "./plugins/prerender";
import { injectCriticalCss } from "./plugins/inject-critical-css";
import babel from "@rolldown/plugin-babel";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, searchForWorkspaceRoot(process.cwd()), "");

  // The API server the dev proxy forwards to
  const serverUrl = env.SERVER_URL || "http://localhost:3000";

  return {
    run: {
      tasks: {
        // Assembles both extensions from the PWA build in dist/. A cache hit saves under a second.
        "build:ext": { command: "node build-extension.ts", dependsOn: ["build"], cache: false },
      },
    },
    server: {
      cors: { origin: true },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
      proxy: {
        "/api": serverUrl,
      },
      warmup: {
        clientFiles: ["./src/main.tsx", "./src/routes/**/*.tsx"],
      },
    },
    resolve: {
      tsconfigPaths: true,
    },
    define: {
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __BUILD_VERSION__: JSON.stringify(
        `${new Date().toISOString().slice(0, 16)}:${process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"}`,
      ),
    },
    plugins: [
      tailwindcss(),
      tanstackRouter({
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
      viteReact({}),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        injectRegister: false,
        outDir: "dist",
        manifest: {
          id: "/",
          name: "Ajot",
          short_name: "Ajot",
          description: "A calm, fast task list for daily capture",
          start_url: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#151a22",
          theme_color: "#151a22",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        includeAssets: ["favicon.svg", "apple-touch-icon-180x180.png"],
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
          globIgnores: ["sw.js"],
        },
        devOptions: { enabled: false },
      }),
      injectFontPreloads(),
      prerender(),
      injectCriticalCss(),
      babel({
        presets: [reactCompilerPreset()],
      }),
    ],
    build: {
      outDir: "dist",
    },
  };
});
