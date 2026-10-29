const MAX_SIDE = 2560;
const THUMB_SIDE = 320;
const PHOTO_QUALITY = 0.85;
const THUMB_QUALITY = 0.7;
const EXIF_SCAN_BYTES = 64 * 1024;

const PHOTO_TYPES = ["image/jpeg", "image/heic", "image/heif"];
// What a browser may decode; the rest gets no thumbnail
const IMAGE_TYPES = [...PHOTO_TYPES, "image/png", "image/gif", "image/webp", "image/avif"];

export type Prepared = { file: Blob; name: string; mimeType: string; thumb?: Blob };

/** A JPEG's APP1 segment holding EXIF, which carries the camera's location among the rest. */
export const hasExif = (bytes: Uint8Array) => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    // Start of scan: the image data follows, and no metadata after it
    if (marker === 0xda) return false;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif")
      return true;
    at += 2 + length;
  }
  return false;
};

/** Scaled to fit within `side` on its longer edge, never up. */
export const fitWithin = (width: number, height: number, side: number) => {
  const scale = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

// Reads the header without decoding the pixels, which for a 48 MP photo would take ~190 MB; it
// also tells whether this browser can decode the type at all
const dimensionsOf = (file: Blob) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`can't decode ${file.type}`));
    };
    image.src = url;
  });

const resizeTo = (size: { width: number; height: number }) =>
  ({ resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" }) as const;

const decode = (file: Blob, size: { width: number; height: number }) =>
  createImageBitmap(file, { imageOrientation: "from-image", ...resizeTo(size) });

// iOS 16.0–16.3 has OffscreenCanvas without convertToBlob
const encode = async (
  bitmap: ImageBitmap,
  quality: number,
  background?: string,
): Promise<Blob | undefined> => {
  const { width, height } = bitmap;
  const offscreen =
    typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype;
  const canvas = offscreen ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) return undefined;
  // A JPEG has no transparency, which would otherwise turn black
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0);
  if (canvas instanceof HTMLCanvasElement)
    return new Promise((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", quality),
    );
  return canvas.convertToBlob({ type: "image/jpeg", quality });
};

const asJpegName = (name: string) => `${name.replace(/\.[^./]+$/, "")}.jpg`;

/**
 * What goes up for a file the user chose: photos only re-encoded when they're over 2560 px or
 * carry EXIF, so screenshots stay sharp, transparency survives and a GIF keeps moving. A HEIC
 * always is, where the browser can decode it, so every other browser can show it. Runs in a page,
 * which has Image. Never rejects: a file it can't read goes up as it is, with no thumbnail.
 */
export const prepareFile = async (file: File, background: string): Promise<Prepared> => {
  const mimeType = file.type || "application/octet-stream";
  const asIs: Prepared = { file, name: file.name, mimeType };
  if (!IMAGE_TYPES.includes(mimeType)) return asIs;
  try {
    const { width, height } = await dimensionsOf(file);
    const head = new Uint8Array(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
    const reencode =
      PHOTO_TYPES.includes(mimeType) &&
      (mimeType !== "image/jpeg" || Math.max(width, height) > MAX_SIDE || hasExif(head));
    // One decode of the file: a photo going up re-encoded gives its thumbnail too
    const source = await decode(file, fitWithin(width, height, reencode ? MAX_SIDE : THUMB_SIDE));
    try {
      const photo = reencode ? await encode(source, PHOTO_QUALITY, background) : undefined;
      const thumbBitmap = reencode
        ? await createImageBitmap(
            source,
            resizeTo(fitWithin(source.width, source.height, THUMB_SIDE)),
          )
        : source;
      const thumb = await encode(thumbBitmap, THUMB_QUALITY, background);
      if (thumbBitmap !== source) thumbBitmap.close();
      return photo
        ? { file: photo, name: asJpegName(file.name), mimeType: "image/jpeg", thumb }
        : { ...asIs, thumb };
    } finally {
      source.close();
    }
  } catch {
    return asIs;
  }
};
