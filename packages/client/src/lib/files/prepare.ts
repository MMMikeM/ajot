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

/** What a transparent image's thumbnail is drawn over: the page's background. */
export const PAGE_BACKGROUND = "oklch(0.165 0.02 262)";

// A worker has no Image, so it decodes the whole picture to measure it: only what the context menu
// saves from a page goes through here, not a 48 MP photo
const measureByDecoding = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
};

// Reads the header without decoding the pixels, which for a 48 MP photo would take ~190 MB; it
// also tells whether this browser can decode the type at all
const dimensionsOf = (file: Blob) =>
  typeof Image === "undefined"
    ? measureByDecoding(file)
    : new Promise<{ width: number; height: number }>((resolve, reject) => {
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

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

// A JPEG has no transparency, which would otherwise turn black
const draw = (context: Context2D, bitmap: ImageBitmap, background?: string) => {
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, bitmap.width, bitmap.height);
  }
  context.drawImage(bitmap, 0, 0);
};

// iOS 16.0–16.3 has OffscreenCanvas without convertToBlob; a worker has no document
const encode = async (
  bitmap: ImageBitmap,
  quality: number,
  background?: string,
): Promise<Blob | undefined> => {
  const { width, height } = bitmap;
  if (typeof OffscreenCanvas !== "undefined" && "convertToBlob" in OffscreenCanvas.prototype) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    draw(context, bitmap, background);
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  draw(context, bitmap, background);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", quality),
  );
};

const asJpegName = (name: string) => `${name.replace(/\.[^./]+$/, "")}.jpg`;

/**
 * What goes up for a file the user chose: photos only re-encoded when they're over 2560 px or
 * carry EXIF, so screenshots stay sharp, transparency survives and a GIF keeps moving. A HEIC
 * always is, where the browser can decode it, so every other browser can show it. Never rejects:
 * a file it can't read goes up as it is, with no thumbnail.
 */
export const prepareFile = async (file: File, background = PAGE_BACKGROUND): Promise<Prepared> => {
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
