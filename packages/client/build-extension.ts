// Assembles the Firefox MV2 and Chrome MV3 extensions from the PWA build in dist/, so it must
// run after `pnpm build`.
import { build } from "vite";
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const CLIENT_DIST = join(ROOT, "dist");
const EXT_OUT = join(ROOT, "dist-extension");

// Both stores reject an upload whose version isn't higher than the last one
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
  version: string;
};
const icons = { 192: "icons/icon-192.png", 512: "icons/icon-512.png" };

// The user picks the server at runtime, so any HTTPS origin, plus local servers for development
const CONNECT_SRC = "connect-src 'self' https: http://localhost:* http://127.0.0.1:*";

const firefoxManifest = {
  manifest_version: 2,
  name: "Ajot",
  version,
  icons,
  browser_specific_settings: {
    gecko: {
      id: "@ajot",
      // Firefox asks before an add-on sends personal data anywhere (140+ has the prompt). Local-only
      // sends nothing; signing in to a server sends the account there, so that's asked then.
      strict_min_version: "140.0",
      data_collection_permissions: {
        required: ["none"],
        optional: ["authenticationInfo", "personallyIdentifyingInfo"],
      },
    },
    gecko_android: { strict_min_version: "142.0" },
  },
  chrome_url_overrides: { newtab: "index.html" },
  content_security_policy: `script-src 'self'; object-src 'self'; ${CONNECT_SRC}`,
  permissions: ["storage", "notifications", "contextMenus", "activeTab", "alarms"],
  background: { scripts: ["background.js"], persistent: true },
};

const chromeManifest = {
  manifest_version: 3,
  name: "Ajot",
  version,
  icons,
  // Silent pushes (userVisibleOnly: false) from an extension worker need Chrome 121.
  minimum_chrome_version: "121",
  chrome_url_overrides: { newtab: "index.html" },
  content_security_policy: {
    extension_pages: `script-src 'self'; object-src 'self'; ${CONNECT_SRC}`,
  },
  permissions: ["storage", "notifications", "contextMenus", "activeTab", "alarms"],
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

  // assemble() deletes the web manifest, so the link would fail on every new tab
  html = html.replace(/<link rel="manifest"[^>]*>/, "");

  writeFileSync(join(outDir, "index.html"), html);
  console.log(`  Extracted ${scriptCount} inline script(s), converted CSS preloads`);
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

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(target.manifest, null, 2));
  console.log(`  Done → ${outDir}`);
};

rmSync(EXT_OUT, { recursive: true, force: true });
for (const target of targets) await assemble(target);
