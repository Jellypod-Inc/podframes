import { copyFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { run } from "./proc";
import { ensureDir } from "./fs";
import type { WordTs } from "../types";

/** Slice [start,end] (seconds) out of an audio file into a fresh re-encoded mp3. */
export async function sliceAudio(input: string, start: number, end: number, output: string): Promise<string> {
  await ensureDir(dirname(output));
  await run("ffmpeg", [
    "-y", "-i", input,
    "-ss", start.toFixed(3), "-to", end.toFixed(3),
    "-c:a", "libmp3lame", "-q:a", "2", output,
  ]);
  return output;
}

/**
 * Re-encode an audio file to mp3, optionally appending `padSec` of trailing silence.
 * Used per-turn so the inter-turn pause lives INSIDE each standalone clip — the master
 * is then a pure concat and the animator gets real (non-frozen) frames for the pause.
 */
export async function padAudioTail(input: string, output: string, padSec: number): Promise<string> {
  await ensureDir(dirname(output));
  // No pad and already mp3 → plain copy. Skipping the pointless re-encode keeps
  // the provider's original encode as the hero audio (one fewer lossy generation)
  // and saves an ffmpeg pass per turn.
  if (padSec <= 0 && extname(input).toLowerCase() === ".mp3" && extname(output).toLowerCase() === ".mp3") {
    await copyFile(input, output);
    return output;
  }
  const af = padSec > 0 ? ["-af", `apad=pad_dur=${padSec.toFixed(3)}`] : [];
  await run("ffmpeg", ["-y", "-i", input, ...af, "-c:a", "libmp3lame", "-q:a", "2", output]);
  return output;
}

/**
 * Concatenate audio files into one re-encoded mp3. Each input is reformatted to a
 * fixed sample rate / channel layout BEFORE concat (inputs may differ in codec /
 * rate across providers), then re-encoded — never `-c copy`, which would click/drift.
 */
export async function concatAudio(inputs: string[], output: string): Promise<string> {
  await ensureDir(dirname(output));
  if (inputs.length === 0) throw new Error("concatAudio: no inputs");
  if (inputs.length === 1) {
    await run("ffmpeg", ["-y", "-i", inputs[0]!, "-c:a", "libmp3lame", "-q:a", "2", output]);
    return output;
  }
  const args: string[] = ["-y"];
  for (const f of inputs) args.push("-i", f);
  const norm = inputs.map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo[a${i}]`).join(";");
  const chain = inputs.map((_, i) => `[a${i}]`).join("") + `concat=n=${inputs.length}:v=0:a=1[out]`;
  args.push("-filter_complex", `${norm};${chain}`, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", output);
  await run("ffmpeg", args);
  return output;
}

/** Probe a media file's duration in seconds via ffprobe. */
export async function probeDuration(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe could not read duration of ${path}`);
  return seconds;
}

/**
 * Speechbase timestamps are documented in seconds, but the docs are inconsistent
 * (one page implied ms). Guard against ms by checking the last word's end against
 * the known audio duration and rescaling if it's ~1000x too large.
 */
export function normalizeTimestamps(words: WordTs[], audioDurationSec: number): WordTs[] {
  if (words.length === 0) return words;
  const lastEnd = words[words.length - 1]!.end;
  // If the last word ends far beyond the audio in "seconds" but lines up in ms, rescale.
  if (lastEnd > audioDurationSec * 4 && lastEnd / 1000 <= audioDurationSec * 1.5) {
    return words.map((w) => ({ ...w, start: w.start / 1000, end: w.end / 1000 }));
  }
  return words;
}
