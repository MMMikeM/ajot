import { describe, expect, test } from "vite-plus/test";
import { fitWithin, hasExif } from "~/lib/files/prepare";

const segment = (marker: number, payload: number[]) => {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
};
const ascii = (text: string) => text.split("").map((c) => c.charCodeAt(0));
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat()]);

describe("hasExif", () => {
  test("finds EXIF after another segment", () => {
    const jfif = segment(0xe0, ascii("JFIF\0"));
    const exif = segment(0xe1, [...ascii("Exif\0\0"), 1, 2, 3]);
    expect(hasExif(jpeg(jfif, exif))).toBe(true);
  });

  test("an APP1 that isn't EXIF, such as XMP, doesn't count", () => {
    expect(hasExif(jpeg(segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0"))))).toBe(false);
  });

  test("stops at the image data, and at a file that isn't a JPEG", () => {
    const exifAfterScan = [...segment(0xda, [0]), ...segment(0xe1, ascii("Exif\0\0"))];
    expect(hasExif(jpeg(exifAfterScan))).toBe(false);
    expect(hasExif(new Uint8Array(ascii("\x89PNG")))).toBe(false);
  });
});

describe("fitWithin", () => {
  test("scales the longer side down to fit, keeping the ratio", () => {
    expect(fitWithin(8064, 6048, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(1000, 4000, 320)).toEqual({ width: 80, height: 320 });
  });

  test("never scales up", () => {
    expect(fitWithin(200, 100, 320)).toEqual({ width: 200, height: 100 });
  });
});
