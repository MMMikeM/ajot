import { markStartup } from "~/lib/startup-timing";
import type { DeskSize } from "./desk-worker";

const sizeOf = (entry: ResizeObserverEntry): DeskSize => {
  const [device] = entry.devicePixelContentBoxSize ?? [];
  if (device) return { width: device.inlineSize, height: device.blockSize };
  const [css] = entry.contentBoxSize;
  const dpr = window.devicePixelRatio || 1;
  return { width: Math.round(css.inlineSize * dpr), height: Math.round(css.blockSize * dpr) };
};

const paintDesk = () => {
  const canvas = document.createElement("canvas");
  if (!("transferControlToOffscreen" in canvas)) return;
  canvas.dataset.desk = "";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    // Above the CSS layers, so the worker's frame shows while the main thread is still busy
    zIndex: "-1",
    pointerEvents: "none",
  });
  document.body.prepend(canvas);

  const worker = new Worker(new URL("./desk-worker.ts", import.meta.url), { type: "module" });
  const offscreen = canvas.transferControlToOffscreen();
  worker.postMessage(offscreen, [offscreen]);
  // The observer's first report waits for the first frame, behind the app's startup
  const dpr = window.devicePixelRatio || 1;
  worker.postMessage({
    width: Math.round(window.innerWidth * dpr),
    height: Math.round(window.innerHeight * dpr),
  } satisfies DeskSize);
  worker.addEventListener(
    "message",
    () => {
      for (const layer of document.querySelectorAll("[data-desk-css]")) layer.remove();
      markStartup("desk-drawn");
    },
    { once: true },
  );

  const observer = new ResizeObserver(([entry]) => worker.postMessage(sizeOf(entry)));
  try {
    observer.observe(canvas, { box: "device-pixel-content-box" });
  } catch {
    observer.observe(canvas);
  }
};

paintDesk();
