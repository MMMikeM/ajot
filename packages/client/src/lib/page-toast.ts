export type PageToastTone = "done" | "failed";

/**
 * Shows what the context menu did, on the page it was used on. Injected by
 * `scripting.executeScript`, which sends only this function's source, so it can use nothing from
 * outside its own body. Styled through the CSSOM, which a page's CSP doesn't block, inside a closed
 * shadow root, so the page's styles can't reach it; it never takes a click.
 */
export function showPageToast(title: string, message: string, tone: PageToastTone) {
  const HOST = "ajot-toast";
  const SHOWN_MS = 4000;
  const FADE_MS = 200;
  const style = (element: HTMLElement | SVGElement, rules: Record<string, string>) => {
    for (const [property, value] of Object.entries(rules))
      element.style.setProperty(property, value, "important");
  };

  for (const old of document.querySelectorAll(HOST)) old.remove();
  const host = document.createElement(HOST);
  style(host, {
    all: "initial",
    position: "fixed",
    right: "16px",
    bottom: "16px",
    "z-index": "2147483647",
    "pointer-events": "none",
  });
  const root = host.attachShadow({ mode: "closed" });

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const card = document.createElement("div");
  card.setAttribute("role", "status");
  style(card, {
    display: "flex",
    gap: "12px",
    "align-items": "flex-start",
    "box-sizing": "border-box",
    width: "min(360px, calc(100vw - 32px))",
    padding: "12px 16px",
    "border-radius": "12px",
    border: "1px solid oklch(1 0 0 / 13%)",
    background: "oklch(0.27 0.017 262)",
    color: "oklch(0.95 0.012 90)",
    "box-shadow": "0 8px 24px oklch(0 0 0 / 35%)",
    "font-family": "system-ui, sans-serif",
    "font-size": "14px",
    "line-height": "20px",
    opacity: "0",
    transform: still ? "none" : "translateY(8px)",
    transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`,
  });

  const SVG = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    icon.setAttribute(name, value);
  style(icon, {
    "flex-shrink": "0",
    color: tone === "done" ? "oklch(0.62 0.16 135)" : "oklch(0.704 0.191 22.216)",
  });
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", tone === "done" ? "M20 6 9 17l-5-5" : "M18 6 6 18M6 6l12 12");
  icon.append(path);

  const text = document.createElement("div");
  style(text, { "min-width": "0", display: "flex", "flex-direction": "column", gap: "2px" });
  const heading = document.createElement("strong");
  heading.textContent = title;
  style(heading, { "font-weight": "600" });
  const detail = document.createElement("span");
  detail.textContent = message;
  style(detail, {
    color: "oklch(0.71 0.016 255)",
    overflow: "hidden",
    display: "-webkit-box",
    "-webkit-line-clamp": "2",
    "-webkit-box-orient": "vertical",
    "overflow-wrap": "anywhere",
  });
  text.append(heading, detail);
  card.append(icon, text);
  root.append(card);
  document.documentElement.append(host);

  requestAnimationFrame(() =>
    requestAnimationFrame(() => style(card, { opacity: "1", transform: "none" })),
  );
  setTimeout(() => {
    style(card, { opacity: "0", transform: still ? "none" : "translateY(8px)" });
    setTimeout(() => host.remove(), FADE_MS);
  }, SHOWN_MS);
}
