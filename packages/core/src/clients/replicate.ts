import Replicate from "replicate";
import { readFile } from "node:fs/promises";
import { writeBytes } from "../util/fs";
import { withDeadline } from "../util/retry";

/** Hard ceiling on one prediction — a hung job must fail the stage, not stall
 *  the pipeline forever (mirrors the fal + Veo client timeouts). */
const RUN_TIMEOUT_MS = 12 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;

export interface AudioToVideoArgs {
  apiKey: string;
  /** e.g. `prunaai/p-video-avatar`. */
  model: string;
  /** First-frame still (sets identity/pose). */
  imagePath: string;
  /** Driving audio — the model lip-syncs to this and takes the clip's duration from it. */
  audioPath: string;
  /** Visual direction for the clip — maps to p-video-avatar's `video_prompt`. */
  prompt: string;
  resolution?: "720p" | "1080p";
  seed?: number;
  outputPath: string;
  onLog?: (msg: string) => void;
}

// p-video-avatar's output schema isn't consistently documented across SDK versions — the JS client can
// hand back a plain URL string, an array of them, or a FileOutput object exposing .url().
function extractUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return extractUrl(output[0]);
  if (output && typeof output === "object" && "url" in output) {
    const u = (output as { url: unknown }).url;
    if (typeof u === "function") return String((u as () => unknown).call(output));
    if (typeof u === "string") return u;
  }
  return undefined;
}

/**
 * Animate a still into a talking clip that lip-syncs to the provided audio, via Replicate's
 * Pruna AI p-video-avatar (image+audio → video). The cheaper/faster default path with the same
 * per-turn shape. We always drive it with real `audio`, so the model's `voice_script`/`voice`
 * text-to-speech path is bypassed. `disable_prompt_upsampling: true` uses our `video_prompt`
 * verbatim (no auto-rewrite) — the locked-off framing our prompt demands must not be "enhanced".
 */
export async function audioToVideo(args: AudioToVideoArgs): Promise<{ path: string; seed?: number }> {
  const replicate = new Replicate({ auth: args.apiKey });

  const input: Record<string, unknown> = {
    video_prompt: args.prompt,
    image: await imageDataUri(args.imagePath),
    audio: await audioDataUri(args.audioPath),
    resolution: args.resolution ?? "720p",
    disable_prompt_upsampling: true,
    ...(args.seed != null ? { seed: args.seed } : {}),
  };

  args.onLog?.(`replicate → ${args.model}`);
  const output = await withDeadline(
    replicate.run(args.model as `${string}/${string}`, { input }),
    RUN_TIMEOUT_MS,
    `replicate ${args.model}`,
  );
  const url = extractUrl(output);
  if (!url) throw new Error("Replicate p-video-avatar returned no output url");

  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Replicate video download failed: ${res.status} ${res.statusText}`);
  await writeBytes(args.outputPath, new Uint8Array(await res.arrayBuffer()));

  return { path: args.outputPath, ...(args.seed != null ? { seed: args.seed } : {}) };
}

async function imageDataUri(path: string): Promise<string> {
  const type = path.endsWith(".jpg") || path.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return toDataUri(path, type);
}

async function audioDataUri(path: string): Promise<string> {
  const type = path.endsWith(".wav") ? "audio/wav" : path.endsWith(".flac") ? "audio/flac" : "audio/mpeg";
  return toDataUri(path, type);
}

async function toDataUri(path: string, contentType: string): Promise<string> {
  const buf = await readFile(path);
  return `data:${contentType};base64,${buf.toString("base64")}`;
}
