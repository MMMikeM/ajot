// A spaced separator: "a | b", "a – b", "a · b", and Amazon's "a : b". An unspaced colon or hyphen
// is the title's own ("Solid Wood: Beech", "Walker-System").
const SEPARATOR = /(\s+(?:[|·•–—-]|:)\s+)/;

const normalized = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// The name a site goes by in its address: amazon.de → amazon, bbc.co.uk → bbc
const siteKeyOf = (url: string) => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  const labels = host.split(".");
  const [secondLevel, topLevel] = labels.slice(-2);
  const underCountry =
    labels.length >= 3 && (secondLevel?.length ?? 0) <= 3 && topLevel?.length === 2;
  const key = underCountry ? labels.at(-3) : (secondLevel ?? labels[0]);
  return normalized(key ?? "");
};

/**
 * A page's title without the site's name, which the details' address already says:
 * "Balance Bike – Mari Kali Stores Cyprus" on marikali.cy is "Balance Bike". What the site's
 * name ends, and everything after it, goes; so does a site's name leading the title on its own.
 */
export const titleWithoutSite = (title: string, url: string, siteName?: string) => {
  const keys = [siteKeyOf(url), normalized(siteName ?? "")].filter((key) => key.length >= 3);
  if (keys.length === 0) return title;
  const parts = title.split(SEPARATOR);
  const names = (segment: string) => keys.some((key) => normalized(segment).includes(key));
  // parts alternate segment, separator, segment…; the first segment is never the site's alone
  for (let i = 2; i < parts.length; i += 2)
    if (names(parts[i]!)) return parts.slice(0, i - 1).join("").trim() || title;
  const leading = parts[0] ?? "";
  if (parts.length > 2 && keys.includes(normalized(leading))) return parts.slice(2).join("").trim();
  return title;
};
