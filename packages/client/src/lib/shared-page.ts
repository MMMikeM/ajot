import { MAX_TEXT, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";

/** What another app hands the share sheet: any of the three, often the address in `text`. */
export type Shared = { title?: string; text?: string; url?: string };

// Apps that send only `text` end it with the address, when they send one
const ADDRESS_AT_END = /(?:^|\s)(https?:\/\/\S+)$/i;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The task for something shared to Ajot: its title, else the text's first line, else the
 * address; the rest of the text and the address go in the details. Undefined when nothing came.
 */
export const taskFromShare = ({ title = "", text = "", url = "" }: Shared) => {
  const body = text.trim();
  const link = url.trim() || body.match(ADDRESS_AT_END)?.[1] || "";
  const rest = (link ? body.replace(link, "") : body).trim();
  const heading = oneLine(title) || oneLine(rest.split("\n")[0] ?? "") || link;
  if (!heading) return undefined;
  const details = [oneLine(rest) === heading ? "" : rest, link === heading ? "" : link]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: cutTo(heading, MAX_TITLE),
    description: details ? cutTo(details, MAX_TEXT) : null,
  };
};
