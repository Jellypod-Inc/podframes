import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Host, PipelineOptions } from "./types";

/**
 * Current model ids (July 2026). Centralized so a model bump is a one-line edit.
 * See README → "Models" for the verification notes behind each id.
 */
export const MODELS = {
  /** High-quality two-host script writing. */
  scriptModel: "gemini-3.1-pro-preview",
  /** B-roll / caption cue analysis. Uses the Pro model (same as the script): it's a single
   *  editorial-judgment call per episode (which lines earn a graphic + the image prompts), so
   *  the better reasoning is worth far more than the marginal cost vs the old 3.5-flash. */
  cueModel: "gemini-3.1-pro-preview",
  /** Nano Banana 2 — host stills (face quality + identity consistency matter here). */
  imageModel: "gemini-3.1-flash-image",
  /** Nano Banana 2 Lite — b-roll images (~4s per image, ~$0.034 per 1K image). */
  brollImageModel: "gemini-3.1-flash-lite-image",
  /** fal LTX-2.3 — audio-to-video, per-turn lip-synced animation. */
  falVideoModel: "fal-ai/ltx-2.3-quality/audio-to-video",
  /** Replicate / Pruna AI p-video — default cheaper, faster per-turn audio-to-video. */
  replicateVideoModel: "prunaai/p-video",
} as const;

export const DEFAULT_OPTIONS: PipelineOptions = {
  videoProvider: "replicate-p-video",
  scriptModel: MODELS.scriptModel,
  cueModel: MODELS.cueModel,
  imageModel: MODELS.imageModel,
  brollImageModel: MODELS.brollImageModel,
  falVideoModel: MODELS.falVideoModel,
  replicateVideoModel: MODELS.replicateVideoModel,
  videoResolution: "720p",
  gapMs: 320,
  maxCues: 10,
  renderQuality: "high",
  fps: 30,
  captionStyle: "clean",
  captionColor: "#22D3EE",
  videoConcurrency: 4,
};

/** Curated default host pair. */
export const DEFAULT_HOSTS: [Host, Host] = [
  {
    id: "host_a",
    name: "Ada",
    speaker: "HOST_A",
    model: "google/gemini-3.1-flash-tts-preview",
    voice: "Aoede",
    side: "left",
    persona: "warm, curious lead host who keeps things moving and asks the sharp follow-up",
    appearance:
      "East Asian woman in her early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face",
  },
  {
    id: "host_b",
    name: "Theo",
    speaker: "HOST_B",
    model: "elevenlabs/eleven_v3",
    voice: "7QN34D2r3hCNwbOYIeK0",
    side: "right",
    persona: "lively, energetic American co-host who riffs, reacts, and grounds the excitement in specifics",
    appearance:
      "man in his late 30s, light stubble, glasses, fair skin, charcoal henley, animated friendly demeanor",
  },
];

export interface ResolvedEnv {
  /** Speechbase gateway key — ALL TTS routes through Speechbase (BYOK lives there). */
  speechbaseApiKey?: string;
  geminiApiKey?: string;
  /** fal.ai key (used for LTX audio-to-video). */
  falApiKey?: string;
  /** Replicate key (used for the default p-video audio-to-video path). */
  replicateApiKey?: string;
}

const loadedEnvRoots = new Set<string>();

/** Load `.env.local` then `.env` from a root (idempotent PER ROOT — dotenv with
 *  override:false is already idempotent per key, so a later call with the real
 *  repo root still loads its files even if a library consumer called first). */
export function ensureEnvLoaded(cwd = process.cwd()): void {
  const root = resolve(cwd);
  if (loadedEnvRoots.has(root)) return;
  for (const file of [".env.local", ".env"]) {
    const path = resolve(root, file);
    if (existsSync(path)) loadDotenv({ path, override: false });
  }
  loadedEnvRoots.add(root);
}

export function resolveEnv(cwd = process.cwd()): ResolvedEnv {
  ensureEnvLoaded(cwd);
  return {
    speechbaseApiKey: process.env.SPEECHBASE_API_KEY || process.env.SPEECH_GATEWAY_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    falApiKey: process.env.FAL_API_KEY || process.env.FAL_KEY,
    replicateApiKey: process.env.REPLICATE_API_KEY || process.env.REPLICATE_API_TOKEN,
  };
}

export function mergeOptions(overrides?: Partial<PipelineOptions>): PipelineOptions {
  return { ...DEFAULT_OPTIONS, ...(overrides ?? {}) };
}
