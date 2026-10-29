import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { PluginOption } from "vite";

// A <link> holds up the scripts until it loads, and the CSP refuses the onload swap that avoids it
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
