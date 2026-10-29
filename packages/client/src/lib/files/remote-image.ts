/**
 * A picture on a page, fetched by the extension's background for the context menu. Another site's
 * is readable only once the optional host permission is granted. Not one of the server's routes,
 * so it has no typed client.
 */
export const fetchImage = async (src: string) => {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`the image answered ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`not an image: ${blob.type}`);
  return blob;
};
