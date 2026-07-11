/**
 * @podframes/core/shared — pure constants + types, ZERO node imports.
 *
 * This is the single runtime source of truth for everything both the pipeline
 * (node) and the web studio (browser) need: brand tokens, provider channel
 * colors, caption presets, canvas sizes. design.md is the human-readable spec;
 * this file is its executable mirror. Import from "@podframes/core/shared" in
 * client components — the main "." entry pulls node-only modules.
 */

export type * from "./types";
import type { PipelineOptions, StageName } from "./types";

/** On-disk project.json schema version. Bumped on breaking shape changes —
 *  older shapes are REFUSED, never migrated (clean-cutover rule).
 *  v2: Veo (clip-library mode), BYOK direct speech, and the branding/titleCard/
 *  showSpeakerTags toggles were removed.
 *  v3: one avatar image per host (stills.hosts[id].imagePath), clip role
 *  "avatar", ClipAsset.sourceImage (was fromStill). */
export const SCHEMA_VERSION = 3;

/** Brand tokens (design.md → Color). Warm stone-charcoal + electric cyan. */
export const BRAND = {
  bg: "#100F0E",
  surface: "#181715",
  surface2: "#201E1B",
  hairline: "#2F2B27",
  text: "#F4F2EC",
  textSecondary: "#A8A298",
  textMuted: "#857C6F",
  accent: "#22D3EE",
  accentBlue: "#5B8CFF",
  /** Dark text that sits ON the cyan accent. */
  accentFg: "#04181D",
  success: "#34D399",
  warn: "#FBBF24",
  danger: "#FF5C5C",
} as const;

/** Provider channel colors — the patch-bay palette (design.md → provider table). */
export const PROVIDER_COLORS: Record<string, string> = {
  openai: "#34D399",
  elevenlabs: "#A78BFA",
  cartesia: "#22D3EE",
  hume: "#FB7185",
  google: "#5B8CFF",
  inworld: "#FBBF24",
  deepgram: "#2DD4BF",
};

export const PROVIDER_COLOR_FALLBACK = "#9AA6B2";

export const providerColor = (provider: string): string =>
  PROVIDER_COLORS[provider] ?? PROVIDER_COLOR_FALLBACK;

/**
 * Caption styles for the picker UI. `maxWords` sets the phrase length each style
 * groups words into — the styles differ in LAYOUT, not just color: slam throws
 * 2 words at a time, bold 3, highlight short pill phrases, boxed a full
 * subtitle line. (Grouping still breaks early on sentence ends and pauses.)
 */
export const CAPTION_STYLE_PRESETS = [
  { id: "clean", label: "Clean", maxWords: 6, description: "Crisp white phrases, active word brightens" },
  { id: "karaoke", label: "Karaoke", maxWords: 5, description: "Active word fills with your color, word by word" },
  { id: "highlight", label: "Highlight", maxWords: 4, description: "Short phrases, color pill behind the active word" },
  { id: "neon", label: "Neon", maxWords: 4, description: "Glowing short phrases, active word lights up" },
  { id: "slam", label: "Slam", maxWords: 2, description: "Two huge uppercase words at a time, popping in" },
  { id: "bold", label: "Bold", maxWords: 3, description: "Three heavy uppercase words per beat" },
  { id: "gradient", label: "Gradient", maxWords: 5, description: "Color→blue gradient-filled phrases" },
  { id: "boxed", label: "Boxed", maxWords: 8, description: "Full subtitle line on a colored block" },
] as const;

/** Grouping length for a caption style (see CAPTION_STYLE_PRESETS.maxWords). */
export const captionMaxWords = (style: string): number =>
  CAPTION_STYLE_PRESETS.find((p) => p.id === style)?.maxWords ?? 6;

/**
 * Additive output treatments. Minimal is the original podframes composition;
 * richer modes change only cue planning + compose/render, never paid host clips.
 */
export const VISUAL_TREATMENTS = [
  {
    id: "minimal",
    label: "Minimal",
    description: "Original podframes cut: talking hosts with sparse supporting cards.",
    cuesPerMinute: 1.5,
    densityLabel: "1–2 beats / min",
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "A designed cold open, alternating graphic zones, and more visual beats.",
    cuesPerMinute: 4,
    densityLabel: "~4 beats / min",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    description: "Full-frame visual takeovers, bold type, and the densest story treatment.",
    cuesPerMinute: 6,
    densityLabel: "~6 beats / min",
  },
] as const;

export const visualTreatmentPreset = (id: string) =>
  VISUAL_TREATMENTS.find((preset) => preset.id === id) ?? VISUAL_TREATMENTS[0];

/**
 * Cold-open slate timing for the rich treatments. The compose builder AND the
 * studio preview both read these — they must agree or the preview lies about
 * when the first host frame appears.
 */
export const TREATMENT_INTRO = {
  /** Slate length, capped by the episode duration. */
  maxSec: 3.2,
  /** Episodes at or under this get no slate (nothing left to watch after it). */
  minEpisodeSec: 1.2,
  /** Fade-out length at the slate's tail. */
  fadeSec: 0.32,
} as const;

export const CANVAS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
} as const;

/**
 * Which downstream stages each kind of edit invalidates. Mirrors the real stage
 * dependency graph (stills depend only on hosts, not the script; captions and
 * branding only affect compose+render). Pure data — the browser uses it to WARN
 * before a destructive edit; the server (editing.ts) uses it to actually clear.
 */
export const INVALIDATION = {
  topic: ["script", "speech", "video", "broll", "compose", "render"],
  aspectRatio: ["stills", "video", "broll", "compose", "render"],
  hostIdentity: ["stills", "video", "compose", "render"],
  hostVoice: ["speech", "video", "broll", "compose", "render"],
  script: ["speech", "video", "broll", "compose", "render"],
  captions: ["compose", "render"],
  visualTreatment: ["compose", "render"],
  broll: ["compose", "render"],
  // Flip is baked into the lip-sync clips (the animator gets a mirrored still), so re-animate.
  flip: ["video", "compose", "render"],
  upload: ["stills", "video", "compose", "render"],
  // Switching animator (fal-ltx / replicate-p-video) makes every existing clip stale — a
  // full clearStages (not clearTurnClips), since ALL of them were made by the old provider.
  videoProvider: ["video", "compose", "render"],
  // Trim edits only affect how existing generated clips are assembled; the paid
  // lip-sync MP4s stay intact.
  clipTrim: ["compose", "render"],
  // Resolution is baked into the base stills the animator conditions on AND every
  // generated clip, so 720p↔1080p re-animates everything (b-roll images are
  // resolution-independent squares and survive).
  videoResolution: ["stills", "video", "compose", "render"],
} as const;

/** Option keys whose edit invalidates stages → the {@link INVALIDATION} entry each maps to. */
const OPTION_INVALIDATION = {
  captionStyle: "captions",
  captionColor: "captions",
  visualTreatment: "visualTreatment",
  videoProvider: "videoProvider",
  videoResolution: "videoResolution",
} as const satisfies Partial<Record<keyof PipelineOptions, keyof typeof INVALIDATION>>;

const STAGE_ORDER: readonly StageName[] = ["script", "speech", "stills", "video", "broll", "compose", "render"];

/**
 * Stages a partial options edit invalidates, comparing only the keys the patch
 * actually carries. Shared by the studio PATCH route and the CLI generate path
 * so `--treatment cinematic` on a finished project re-composes exactly like the
 * same switch made in the studio would.
 */
export function optionInvalidations(
  current: PipelineOptions,
  patch: Partial<PipelineOptions>,
): StageName[] {
  const stale = new Set<StageName>();
  for (const key of Object.keys(OPTION_INVALIDATION) as (keyof typeof OPTION_INVALIDATION)[]) {
    if (patch[key] !== undefined && patch[key] !== current[key]) {
      for (const stage of INVALIDATION[OPTION_INVALIDATION[key]]) stale.add(stage);
    }
  }
  return STAGE_ORDER.filter((stage) => stale.has(stage));
}

/** The animation backends the studio + CLI render pickers/help from. */
export const VIDEO_PROVIDERS = [
  {
    id: "replicate-p-video",
    label: "P-Video Avatar",
    vendor: "Replicate",
    blurb: "Default cheaper, faster per-turn lip-sync.",
    envKey: "REPLICATE_API_KEY",
  },
  {
    id: "fal-ltx",
    label: "LTX-2.3",
    vendor: "fal.ai",
    blurb: "Higher-quality per-turn lip-sync alternative.",
    envKey: "FAL_API_KEY",
  },
] as const;

export type VideoProviderId = (typeof VIDEO_PROVIDERS)[number]["id"];

/**
 * Published per-second animation prices (checked 2026-07 — see each provider's
 * pricing page; update here when they move):
 *   fal.ai LTX-2.3 audio-to-video:  $0.10/s (all resolutions)     — fal.ai/models/fal-ai/ltx-2.3/audio-to-video
 *   Replicate prunaai/p-video-avatar: $0.025/s 720p · $0.045/s 1080p — replicate.com/prunaai/p-video-avatar
 * Used for the pre-generation cost estimate in the studio — an ESTIMATE, not a quote.
 */
export const PRICING: Record<VideoProviderId, { perSecond: Record<"720p" | "1080p", number> }> = {
  "fal-ltx": { perSecond: { "720p": 0.1, "1080p": 0.1 } },
  "replicate-p-video": { perSecond: { "720p": 0.025, "1080p": 0.045 } },
};

/** Estimated $ to animate `seconds` of clips on a provider at a resolution. */
export function estimateVideoCost(
  provider: string,
  resolution: "720p" | "1080p",
  seconds: number,
): number | null {
  const p = PRICING[provider as VideoProviderId];
  if (!p) return null;
  return seconds * p.perSecond[resolution];
}
