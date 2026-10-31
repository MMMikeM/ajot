const ADDRESS = /https?:\/\/[^\s<>"'“”‘’[\]{}]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?…'"]+$/;

const count = (text: string, char: string) => text.split(char).length - 1;

/** Trailing punctuation is the sentence's, as is a `)` with no `(` in the address, as in `(see …)`. */
const trimSentence = (match: string) => {
  let address = match.replace(TRAILING_PUNCTUATION, "");
  while (address.endsWith(")") && count(address, ")") > count(address, "("))
    address = address.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
  return address;
};

export type Link = { href: string; label: string };

const decoded = (text: string) => {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
};

/** The label drops the scheme and a bare trailing slash, so the address's site leads. */
const labelOf = (url: URL) =>
  decoded(`${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`);

/** Each distinct web address in `text`, in order. */
export const linksIn = (text: string): Link[] => {
  const seen = new Set<string>();
  const links: Link[] = [];
  for (const [match] of text.matchAll(ADDRESS)) {
    const address = trimSentence(match);
    if (!URL.canParse(address)) continue;
    const url = new URL(address);
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ href: url.href, label: labelOf(url) });
  }
  return links;
};
