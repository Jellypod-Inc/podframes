import { fal } from "@fal-ai/client";
import { readFile, stat } from "node:fs/promises";
import { writeBytes } from "../util/fs";
import { withDeadline } from "../util/retry";

/** Hard ceiling on one clip generation — a hung queue job must fail the stage,
 *  not stall the whole pipeline forever. */
const SUBSCRIBE_TIMEOUT_MS = 12 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60_000;

let configuredKey: string | null = null;
function ensureConfigured(apiKey: string): void {
  if (configuredKey === apiKey) return;
  fal.config({ credentials: apiKey });
  configuredKey = apiKey;
}

// The same base still is animated for every one of a host's turns — upload it
// once per (path, mtime) instead of ~12 identical multi-MB uploads per episode.
const uploadCache = new Map<string, Promise<string>>();

async function uploadFile(path: string, contentType: string): Promise<string> {
  const { mtimeMs } = await stat(path);
  const key = `${path}:${mtimeMs}`;
  let pending = uploadCache.get(key);
  if (!pending) {
    pending = (async () => {
      const buf = await readFile(path);
      const blob = new Blob([new Uint8Array(buf)], { type: contentType });
      return fal.storage.upload(blob);
    })();
    // A failed upload must not poison the cache.
    pending.catch(() => uploadCache.delete(key));
    uploadCache.set(key, pending);
  }
  return pending;
}

export interface AudioToVideoArgs {
  apiKey: string;
  /** e.g. `fal-ai/ltx-2.3-quality/audio-to-video`. */
  model: string;
  /** First-frame still (sets identity/pose). */
  imagePath: string;
  /** Driving audio — the model lip-syncs to this. */
  audioPath: string;
  prompt: string;
  /** "auto" matches the input image aspect ratio. */
  resolution?: string;
  /** First-frame conditioning 0..1 (higher = framing locked to the input image). */
  imageStrength?: number;
  videoQuality?: "low" | "medium" | "high" | "maximum";
  negativePrompt?: string;
  seed?: number;
  /** Embed the driving audio in the output clip (audible standalone previews). */
  includeAudio?: boolean;
  outputPath: string;
  onLog?: (msg: string) => void;
}

/**
 * Animate a still into a talking clip that lip-syncs to the provided audio,
 * via fal's LTX-2.3 audio-to-video. `match_audio_length` makes the clip length
 * track the audio; `includeAudio` embeds the driving track in the clip so it is
 * audible on its own (the final composition mutes clips and plays the mixed
 * Speechbase master, so embedded audio never double-plays).
 */
export async function audioToVideo(args: AudioToVideoArgs): Promise<{ path: string; seed?: number }> {
  ensureConfigured(args.apiKey);

  const imageType =
    args.imagePath.endsWith(".jpg") || args.imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  const audioType = args.audioPath.endsWith(".wav") ? "audio/wav" : "audio/mpeg";

  const [image_url, audio_url] = await Promise.all([
    uploadFile(args.imagePath, imageType),
    uploadFile(args.audioPath, audioType),
  ]);

  const input: Record<string, unknown> = {
    prompt: args.prompt,
    image_url,
    audio_url,
    match_audio_length: true,
    generate_audio: args.includeAudio ?? true,
    resolution: args.resolution ?? "auto",
    // CRITICAL: the endpoint defaults enable_prompt_expansion to TRUE — an LLM
    // rewrite that re-adds cinematic camera moves (push-ins, zooms) and undoes
    // the locked-off framing our prompt demands. Same trap as p-video-avatar's
    // prompt_upsampling. Our exact words must reach the model.
    enable_prompt_expansion: false,
    // High first-frame adherence: the podcast shot must HOLD the input framing
    // for the whole clip (endpoint default 0.7 drifts; 0.5 wanders/zooms).
    image_strength: args.imageStrength ?? 0.85,
    // Generate at the model's native frame rate (24) — the composition time-gates
    // clips regardless of their native fps, and forcing 30 costs quality/sync.
    video_quality: args.videoQuality ?? "high",
    ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
    ...(args.seed != null ? { seed: args.seed } : {}),
  };

  const result = (await withDeadline(
    fal.subscribe(args.model, {
      input,
      logs: true,
      onQueueUpdate: (u: { status: string; logs?: { message?: string }[] }) => {
        if (u.status === "IN_PROGRESS" && args.onLog) {
          for (const l of u.logs ?? []) if (l?.message) args.onLog(l.message);
        }
      },
    } as never) as Promise<unknown>,
    SUBSCRIBE_TIMEOUT_MS,
    `fal ${args.model}`,
  )) as { data?: { video?: { url?: string }; seed?: number } };

  const url = result?.data?.video?.url;
  if (!url) throw new Error("fal audio-to-video returned no video url");

  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`fal video download failed: ${res.status} ${res.statusText}`);
  await writeBytes(args.outputPath, new Uint8Array(await res.arrayBuffer()));

  return { path: args.outputPath, ...(result.data?.seed != null ? { seed: result.data.seed } : {}) };
}
