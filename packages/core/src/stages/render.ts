import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stat, rm } from "node:fs/promises";
import { run } from "../util/proc";
import { fileExists } from "../util/fs";
import { probeDuration } from "../util/audio";
import type { StageContext } from "./context";
import type { OutputArtifact } from "../types";

/**
 * Resolve how to invoke the hyperframes CLI. pnpm nests the bin under the
 * depending package (packages/core/node_modules/.bin), so the most reliable
 * path is to resolve the package's actual CLI entry and run it with `node`.
 */
function resolveHyperframes(root: string): { cmd: string; prefix: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve("hyperframes/package.json");
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binField = pkg.bin;
    const binRel =
      typeof binField === "string"
        ? binField
        : (binField?.hyperframes ?? (binField ? Object.values(binField)[0] : undefined));
    if (binRel) return { cmd: process.execPath, prefix: [join(dirname(pkgJsonPath), binRel)] };
  } catch {
    /* fall through to .bin / npx */
  }
  for (const dir of [
    join(root, "node_modules", ".bin"),
    join(root, "packages", "core", "node_modules", ".bin"),
  ]) {
    const local = join(dir, "hyperframes");
    if (fileExists(local)) return { cmd: local, prefix: [] };
  }
  return { cmd: "npx", prefix: ["--yes", "hyperframes"] };
}

export async function runRender(ctx: StageContext): Promise<void> {
  const { project, reporter } = ctx;
  const log = reporter.stage("render");
  const { composition, options } = project.state;
  if (!composition) throw new Error("render stage requires a composition");

  const compDir = project.abs(composition.dir);
  const outPath = project.path("output.mp4");
  const { cmd, prefix } = resolveHyperframes(project.root);
  const env = { ...process.env, PRODUCER_BROWSER_GPU_MODE: "hardware" };

  // Lint (non-fatal: surface issues but still attempt the render). Skipped for
  // draft renders — that's the fast iteration loop.
  if (options.renderQuality !== "draft") {
    log.info("linting composition");
    try {
      await run(cmd, [...prefix, "lint", compDir], { env });
      log.info("lint clean");
    } catch (err) {
      log.warn(`lint reported issues:\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The composition is authored at the fixed 1920-based canvas (every px value
  // in compose/builder.ts assumes it); videoResolution scales the FINAL file.
  const scale = options.videoResolution === "720p" ? 2 / 3 : 1;
  const targetW = Math.round(composition.width * scale);
  const targetH = Math.round(composition.height * scale);
  log.info(
    `rendering ${composition.width}x${composition.height} @ ${options.fps}fps · quality=${options.renderQuality} · output ${targetW}x${targetH} (slow)`,
  );
  const rawPath = project.path("output.raw.mp4");
  await run(
    cmd,
    [
      ...prefix,
      "render",
      compDir,
      "--output",
      rawPath,
      "--fps",
      String(options.fps),
      "--quality",
      options.renderQuality,
      // hyperframes 0.6.x multi-worker captures: secondary workers render a
      // viewport ~87px shorter than data-height, leaving a black bottom band
      // for the first (N-1)/N of the video. One worker is 3-5× slower but
      // correct. Verify by sampling bottom rows, not by eyeballing stills.
      "--workers",
      "1",
    ],
    { env, inherit: true },
  );

  if (!fileExists(rawPath)) throw new Error("render finished but output is missing");

  // ── Kill the black first frame (the REAL cause). HyperFrames stamps the first video
  // frame at PTS ~0.021s (audio starts at 0), so the mp4 muxer writes an empty edit-list
  // entry (media_time -1) covering 0→0.021s. Players that honor edit lists — QuickTime,
  // Safari, most embedded previews — render that empty edit as a BLACK first frame.
  // ffmpeg's `-ss 0` / signalstats DECODE frames and ignore the edit, which is why frame
  // captures always looked fine while players showed black. Fix: re-read ignoring the
  // broken edit list; 1080p stream-copies (LOSSLESS) so the video starts cleanly at PTS 0.
  //
  // 720p downscales HERE (supersampled from the 1920 canvas → sharper than a native
  // 720p capture). A re-encode MUST disable B-frames (-bf 0): libx264's B-frames
  // reintroduce the exact empty leading edit this step exists to kill.
  const downscale = targetW !== composition.width;
  log.info(
    downscale
      ? `normalizing mp4 + downscaling to ${targetW}x${targetH} (videoResolution=${options.videoResolution})`
      : "normalizing mp4 (stripping empty leading edit → no black first frame)",
  );
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-ignore_editlist", "1",
    "-i", rawPath,
    ...(downscale
      ? [
          "-vf", `scale=${targetW}:${targetH}:flags=lanczos`,
          "-c:v", "libx264",
          "-bf", "0",
          "-preset", options.renderQuality === "draft" ? "veryfast" : "medium",
          "-crf", options.renderQuality === "draft" ? "22" : "18",
          "-pix_fmt", "yuv420p",
          "-c:a", "copy",
        ]
      : ["-c", "copy"]),
    "-movflags", "+faststart",
    outPath,
  ]);
  await rm(rawPath, { force: true });

  if (!fileExists(outPath)) throw new Error("mp4 normalization failed — output.mp4 missing");
  const [{ size }, durationSec] = await Promise.all([stat(outPath), probeDuration(outPath)]);

  const output: OutputArtifact = { videoPath: project.rel(outPath), durationSec, bytes: size };
  project.state.output = output;
  project.markDone("render", { bytes: size, durationSec });
  await project.save();

  log.success(`rendered → ${project.rel(outPath)} (${(size / 1e6).toFixed(1)} MB, ${durationSec.toFixed(1)}s)`);
}
