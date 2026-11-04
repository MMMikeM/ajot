import { ext } from "~/lib/ext";

export type PageMeta = { title?: string; siteName?: string; image?: string };

// A page still loading holds the script back; the add goes on without what it would have said
const PAGE_READ_MS = 500;

/**
 * What the page says about itself for link previews (Open Graph). Injected by
 * `scripting.executeScript`, which sends only this function's source, so it uses nothing from
 * outside its own body.
 */
function readOpenGraph(): PageMeta {
  const content = (property: string) =>
    document
      .querySelector<HTMLMetaElement>(`meta[property="${property}"], meta[name="${property}"]`)
      ?.content.trim() || undefined;
  const image = content("og:image") ?? content("twitter:image");
  let absoluteImage: string | undefined;
  try {
    absoluteImage = image ? new URL(image, document.baseURI).href : undefined;
  } catch {
    absoluteImage = undefined;
  }
  return {
    title: content("og:title"),
    siteName: content("og:site_name"),
    image: absoluteImage?.startsWith("http") ? absoluteImage : undefined,
  };
}

/**
 * The page's own title, site name and picture, where the extension may read the tab: a click on its
 * menu or toolbar button lets it. Empty for a page it can't, such as the browser's own.
 */
export const readPageMeta = async (tabId: number | undefined): Promise<PageMeta> => {
  if (tabId === undefined || tabId < 0) return {};
  const read = ext.scripting
    .executeScript({ target: { tabId }, func: readOpenGraph })
    .then(([frame]) => (frame?.result as PageMeta | undefined) ?? {});
  return withinMs(PAGE_READ_MS, read, {});
};

/** The work's result, or `fallback` if it fails or takes longer than `ms`. */
export const withinMs = <T>(ms: number, work: Promise<T>, fallback: T) =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });

/** Whether images may be read from any site, so a page's picture can be attached without asking. */
export const mayReadImages = () =>
  ext.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
