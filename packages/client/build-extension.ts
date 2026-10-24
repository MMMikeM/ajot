// Assembles the Firefox MV2 and Chrome MV3 extensions from the PWA build in dist/, so it must
// run after `pnpm build`.
import { build } from "vite";
import { readFileSync, writeFileSync, cpSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const CLIENT_DIST = join(ROOT, "dist");
const EXT_OUT = join(ROOT, "dist-extension");

// The user picks the server at runtime, so any HTTPS origin, plus local servers for development
const CONNECT_SRC = "connect-src 'self' https: http://localhost:* http://127.0.0.1:*";

const firefoxManifest = {
  manifest_version: 2,
  name: "New Tab Todo",
  version: "1.0.0",
  browser_specific_settings: { gecko: { id: "newtab-todo@local" } },
  chrome_url_overrides: { newtab: "index.html" },
  content_security_policy: `script-src 'self' 'unsafe-eval'; object-src 'self'; ${CONNECT_SRC}`,
  permissions: ["storage"],
  background: { scripts: ["background.js"], persistent: true },
};

const chromeManifest = {
  manifest_version: 3,
  name: "New Tab Todo",
  version: "1.0.0",
  // Silent pushes (userVisibleOnly: false) from an extension worker need Chrome 121.
  minimum_chrome_version: "121",
  chrome_url_overrides: { newtab: "index.html" },
  // MV3 rejects 'unsafe-eval'; 'wasm-unsafe-eval' is enough for wa-sqlite.
  content_security_policy: {
    extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; ${CONNECT_SRC}`,
  },
  permissions: ["storage", "notifications"],
  background: { service_worker: "background.js" },
};

const patchHtml = (outDir: string) => {
  let html = readFileSync(join(outDir, "index.html"), "utf-8");
  let scriptCount = 0;

  // Extension CSP blocks inline scripts
  html = html.replace(
    /<script([^>]*)>([\s\S]+?)<\/script>/g,
    (match, attrs: string, content: string) => {
      if (attrs.includes("src=") || !content.trim()) return match;
      const filename = `_inline-${scriptCount++}.js`;
      writeFileSync(join(outDir, filename), content);
      const typeAttr = attrs.match(/type="([^"]*)"/)
        ? ` type="${attrs.match(/type="([^"]*)"/)![1]}"`
        : "";
      const asyncAttr = attrs.includes("async") ? " async" : "";
      return `<script${typeAttr}${asyncAttr} src="/${filename}"></script>`;
    },
  );

  // Extension CSP blocks the async preload's inline onload handler (script-src-attr), and every
  // asset is local in the extension, so a blocking stylesheet costs nothing
  html = html.replace(
    /<link rel="preload" href="([^"]+)" as="style" onload="[^"]*"><noscript>.*?<\/noscript>/g,
    (_, href) => `<link rel="stylesheet" href="${href}">`,
  );

  writeFileSync(join(outDir, "index.html"), html);
  console.log(`  Extracted ${scriptCount} inline script(s), converted CSS preloads`);
};

// Firefox extension Web Workers can't fetch moz-extension:// resources, even
// with credentials: "same-origin", and Chrome's connect-src blocks the data:
// URL the worker falls back to. Patch the OPFS worker to set wasmBinary
// directly so Emscripten never calls fetch() for the WASM file.
// The bytes come from the worker's own data: URL: assets/wa-sqlite.wasm is a
// different build, and loading it fails with "_emscripten_stack_get_current
// is not a function".
const inlineWasm = (outDir: string) => {
  for (const f of readdirSync(join(outDir, "assets"))) {
    if (!f.startsWith("opfs-worker-") || !f.endsWith(".js")) continue;
    const path = join(outDir, "assets", f);
    const src = readFileSync(path, "utf-8");
    const wasmBase64 = src.match(/data:application\/wasm;base64,([A-Za-z0-9+/=]+)/)?.[1];
    if (!wasmBase64) throw new Error(`No embedded WASM found in ${f}`);
    const wasmBytes = `Uint8Array.from(atob("${wasmBase64}"),c=>c.charCodeAt(0)).buffer`;
    const patched = src.replace("var wasmBinary;", `var wasmBinary = ${wasmBytes};`);
    if (patched === src) throw new Error(`Failed to patch wasmBinary in ${f}`);
    writeFileSync(path, patched);
    console.log(`  Inlined WASM in ${f} (${(wasmBase64.length / 1024).toFixed(0)} KB base64)`);
  }
};

type Target = {
  name: "firefox" | "chrome";
  backgroundEntry: string;
  manifest: Record<string, unknown>;
};

const targets: Target[] = [
  {
    name: "firefox",
    backgroundEntry: "background-firefox.ts",
    manifest: firefoxManifest,
  },
  {
    name: "chrome",
    backgroundEntry: "background-chrome.ts",
    manifest: chromeManifest,
  },
];

const assemble = async (target: Target) => {
  const outDir = join(EXT_OUT, target.name);
  console.log(`[build:ext] ${target.name}`);

  cpSync(CLIENT_DIST, outDir, { recursive: true });
  // The extension ships neither a service worker nor a web manifest
  rmSync(join(outDir, "sw.js"), { force: true });
  rmSync(join(outDir, "manifest.webmanifest"), { force: true });

  // emptyOutDir: false keeps the PWA assets just copied; publicDir: false stops Vite re-copying
  // public/, which would bring back manifest.webmanifest
  await build({
    configFile: false,
    publicDir: false,
    resolve: { alias: { "~": join(ROOT, "src") } },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    build: {
      lib: {
        entry: join(ROOT, "src", target.backgroundEntry),
        formats: ["iife"],
        name: "background",
        fileName: () => "background.js",
      },
      outDir,
      emptyOutDir: false,
      minify: false,
    },
    logLevel: "warn",
  });
  console.log(`  Built ${target.backgroundEntry} → background.js`);

  patchHtml(outDir);

  inlineWasm(outDir);

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(target.manifest, null, 2));
  console.log(`  Done → ${outDir}`);
};

rmSync(EXT_OUT, { recursive: true, force: true });
for (const target of targets) await assemble(target);
