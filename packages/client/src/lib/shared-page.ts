import { MAX_TEXT, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";
import type { SharedText } from "@newtab-todo/shared/share-target";

// Apps that send only `text` end it with the address, when they send one
const ADDRESS_AT_END = /(?:^|\s)(https?:\/\/\S+)$/i;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const filesHeading = (files: { name: string }[]) =>
  files.length > 1 ? `${files.length} files` : (files[0]?.name ?? "");

/**
 * The task for something shared to Ajot: its title, else the text's first line, else the
 * address, else what files came; the rest of the text and the address go in the details.
 * Undefined when nothing came.
 */
export const taskFromShare = ({
  title = "",
  text = "",
  url = "",
  files = [],
}: SharedText & { files?: { name: string }[] }) => {
  const body = text.trim();
  const link = url.trim() || body.match(ADDRESS_AT_END)?.[1] || "";
  const rest = (link ? body.replace(link, "") : body).trim();
  const heading =
    oneLine(title) || oneLine(rest.split("\n")[0] ?? "") || link || filesHeading(files);
  if (!heading) return undefined;
  const details = [oneLine(rest) === heading ? "" : rest, link === heading ? "" : link]
    .filter(Boolean)
    .join("\n\n");
  return {
    title: cutTo(heading, MAX_TITLE),
    description: details ? cutTo(details, MAX_TEXT) : null,
  };
};
