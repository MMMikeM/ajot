import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PluginOption } from "vite";

/**
 * Puts the whole stylesheet in the page: a <link> holds up the scripts until it arrives, and the
 * CSP refuses the onload handler that would load it without blocking. The service worker and the
 * extensions serve the page from disk, so its extra bytes cost a download once per deploy.
 */
export const inlineStylesheet = (): PluginOption => {
  const outDir = join(resolve(import.meta.dirname, ".."), "dist");

  return {
    name: "inline-stylesheet",
    apply: "build",
    closeBundle() {
      if (this.environment?.name !== "client") return;

      const indexPath = join(outDir, "index.html");
      const html = readFileSync(indexPath, "utf-8");
      const link = html.match(/<link rel="stylesheet"[^>]+href="([^"]+\.css)"[^>]*>/);
      if (!link) throw new Error("inline-stylesheet: <link rel=stylesheet> not found");

      const css = readFileSync(join(outDir, link[1]), "utf-8");
      writeFileSync(
        indexPath,
        html.replace(link[0], () => `<style>${css}</style>`),
      );
      console.log(`  Inlined the stylesheet (${Math.round(css.length / 1024)}KB)`);
    },
  };
};
