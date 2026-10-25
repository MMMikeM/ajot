#!/usr/bin/env node
// usage: pair.mjs <before-dir> <after-dir> <out-dir>
// Every PNG in both dirs becomes one image, Before on the left and After on the right, titled from
// its file name. Every clip dir in both (video.webm + timeline.json) is trimmed with cut-demo.mjs
// and joined into one side-by-side mp4. Needs ImageMagick (magick) and ffmpeg.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const [beforeDir, afterDir, outDir] = process.argv.slice(2);
if (!beforeDir || !afterDir || !outDir) {
  console.error("usage: pair.mjs <before-dir> <after-dir> <out-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`${command} failed:\n${result.stderr || result.stdout}`);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
};

// ImageMagick needs a font file, not a name, when it has no fontconfig
const FONT =
  [
    process.env.PAIR_FONT,
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].find((file) => file && existsSync(file)) ?? "Helvetica";
const BG = "#0b0e14";
const FG = "#e8e4da";
const MUTED = "#9aa3b2";
const title = (name) => name.replace(/^(phone|desktop)-\d+-/, "$1: ").replaceAll("-", " ");

// Stills
const shots = readdirSync(afterDir).filter(
  (f) => f.endsWith(".png") && existsSync(path.join(beforeDir, f)),
);
for (const file of shots) {
  const name = file.replace(/\.png$/, "");
  const side = (dir, label) => [
    "(",
    path.join(dir, file),
    "-resize",
    name.startsWith("desktop") ? "1200x" : "520x",
    "-background",
    BG,
    "-fill",
    MUTED,
    "-font",
    FONT,
    "-pointsize",
    "28",
    "label:" + label,
    "+swap",
    "-gravity",
    "center",
    "-append",
    ")",
  ];
  run("magick", [
    "-background",
    BG,
    ...side(beforeDir, "Before"),
    ...side(afterDir, "After"),
    "-gravity",
    "north",
    "-splice",
    "0x0",
    "+smush",
    "40",
    // smush leaves a page offset that would push the title off the left edge
    "+repage",
    "-fill",
    FG,
    "-pointsize",
    "34",
    "-gravity",
    "north",
    "-splice",
    "0x70",
    "-annotate",
    "+0+18",
    title(name),
    "-bordercolor",
    BG,
    "-border",
    "24",
    path.join(outDir, file),
  ]);
  console.log(`pair: ${path.join(outDir, file)}`);
}

// Clips
const isClip = (dir, name) =>
  existsSync(path.join(dir, name, "video.webm")) &&
  existsSync(path.join(dir, name, "timeline.json"));
const clips = readdirSync(afterDir).filter(
  (name) =>
    statSync(path.join(afterDir, name)).isDirectory() &&
    isClip(afterDir, name) &&
    isClip(beforeDir, name),
);
const cutDemo = path.join(path.dirname(new URL(import.meta.url).pathname), "cut-demo.mjs");
const probe = (file) =>
  Number(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );

for (const name of clips) {
  const cut = (dir, label) => {
    const out = path.join(outDir, `${name}.${label}.mp4`);
    run("node", [cutDemo, path.join(dir, name), out]);
    return out;
  };
  const before = cut(beforeDir, "before");
  const after = cut(afterDir, "after");
  const labels = ["Before", "After"].map((text) => {
    const file = path.join(outDir, `${name}.${text}.label.png`);
    run("magick", [
      "-background",
      BG,
      "-fill",
      MUTED,
      "-font",
      FONT,
      "-pointsize",
      "26",
      "-size",
      "390x48",
      "-gravity",
      "center",
      `label:${text}`,
      file,
    ]);
    return file;
  });
  const length = Math.max(probe(before), probe(after));
  // The shorter side holds its last frame, so both play to the end
  const pad = (input, index) =>
    `[${input}:v]scale=390:-2,tpad=stop_mode=clone:stop_duration=${length.toFixed(2)}[v${index}];[${input + 2}:v][v${index}]vstack[s${index}]`;
  const out = path.join(outDir, `${name}.mp4`);
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    before,
    "-i",
    after,
    "-i",
    labels[0],
    "-i",
    labels[1],
    "-filter_complex",
    `${pad(0, 0)};${pad(1, 1)};[s0][s1]hstack=inputs=2,pad=iw+60:ih+40:30:20:color=${BG}[out]`,
    "-map",
    "[out]",
    "-t",
    length.toFixed(2),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    "-movflags",
    "+faststart",
    out,
  ]);
  console.log(
    `pair: ${out} (${length.toFixed(1)}s); contact sheets: ${name}.before.contact.png, ${name}.after.contact.png`,
  );
}
