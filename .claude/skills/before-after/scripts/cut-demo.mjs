#!/usr/bin/env node
// usage: cut-demo.mjs <test-output-dir> <out.mp4> [--tail 0.7] [--lead 0]
// --tail defaults to 0.7s because the recording runs ~0.3s behind the timeline marks, and the next
// action (a reload, a navigation) starts tearing the page down before hide() returns.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const [outputDir, outFile] = process.argv.slice(2);
if (!outputDir || !outFile) {
  console.error("usage: cut-demo.mjs <test-output-dir> <out.mp4> [--tail 0.7] [--lead 0]");
  process.exit(2);
}
const videoPath = path.join(outputDir, "video.webm");
const timelinePath = path.join(outputDir, "timeline.json");
for (const required of [videoPath, timelinePath]) {
  if (!existsSync(required)) {
    console.error(`missing ${required}`);
    process.exit(2);
  }
}

const tail = option("tail", 0.7);
const lead = option("lead", 0);
const duration = Number(
  run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath]),
);
const { segments } = JSON.parse(readFileSync(timelinePath, "utf8"));
const kept = segments
  .map(([start, end], index) => [
    start + lead,
    index === segments.length - 1 ? Math.min(end, duration) : end - tail,
  ])
  .filter(([start, end]) => end - start > 0.2);
if (kept.length === 0) {
  console.error("no segment survives the trim; check timeline.json against the recording");
  process.exit(1);
}

const filters = kept.map(
  ([start, end], index) =>
    `[0:v]trim=start=${start.toFixed(2)}:end=${end.toFixed(2)},setpts=PTS-STARTPTS[s${index}]`,
);
const joined = `${kept.map((_, index) => `[s${index}]`).join("")}concat=n=${kept.length}:v=1[out]`;
run("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  videoPath,
  "-filter_complex",
  [...filters, joined].join(";"),
  "-map",
  "[out]",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-crf",
  "18",
  "-movflags",
  "+faststart",
  outFile,
]);

const framesDir = `${outFile}.frames`;
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir);
run("ffmpeg", [
  "-loglevel",
  "error",
  "-i",
  outFile,
  "-vf",
  "fps=2,scale=480:-1",
  path.join(framesDir, "f-%03d.png"),
]);
const frameCount = readdirSync(framesDir).length;
const columns = 5;
const rows = Math.ceil(frameCount / columns);
const sheet = outFile.replace(/\.mp4$/, "") + ".contact.png";
run("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-i",
  path.join(framesDir, "f-%03d.png"),
  "-vf",
  `tile=${columns}x${rows}:padding=4:color=red`,
  "-frames:v",
  "1",
  sheet,
]);
rmSync(framesDir, { recursive: true, force: true });

const outDuration = Number(
  run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outFile]),
);
console.log(`recording ${duration.toFixed(1)}s -> ${outFile} ${outDuration.toFixed(1)}s`);
kept.forEach(([start, end]) => console.log(`  kept ${start.toFixed(2)}-${end.toFixed(2)}s`));
console.log(`contact sheet: ${sheet} (${frameCount} frames, 500ms apart, read left to right)`);
