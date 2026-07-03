/**
 * Shared data model for the podframes pipeline.
 *
 * Every stage reads and writes a slice of {@link ProjectState}. The state is
 * persisted to `projects/<slug>/project.json` after each stage so runs are
 * fully resumable (mirrors the resume model in the HyperFrames workflows).
 */

export type AspectRatio = "16:9" | "9:16";

/** Caption visual styles (per-word karaoke timing, different looks). */
export type CaptionStyle =
  | "clean"
  | "karaoke"
  | "highlight"
  | "neon"
  | "slam"
  | "bold"
  | "gradient"
  | "boxed";

/** A known TTS provider. `string` keeps it open for new gateway providers. */
export type ProviderId =
  | "openai"
  | "elevenlabs"
  | "cartesia"
  | "hume"
  | "google"
  | "inworld"
  | "deepgram"
  | (string & {});

/** One of the two podcast hosts: a voice + a face + a personality. */
export interface Host {
  /** Stable id, e.g. `host_a`. */
  id: string;
  /** Display name, e.g. "Ada". */
  name: string;
  /** Script label the model writes against, e.g. `HOST_A`. */
  speaker: string;
  /** `provider/model`, e.g. `openai/gpt-4o-mini-tts`. */
  model: string;
  /** Provider voice id, e.g. `alloy` or an ElevenLabs UUID. */
  voice: string;
  /** Which side this host occupies in the conversation layout. */
  side: "left" | "right";
  /** Personality / speaking-style hint for the script writer. */
  persona?: string;
  /** Visual description for the image model (kept consistent across stills). */
  appearance?: string;
  /** Built-in avatar key, when the host was chosen from the web roster. */
  avatarKey?: string;
  /** Provider-specific TTS tuning passed through Speechbase (e.g. ElevenLabs voice_settings). */
  providerOptions?: Record<string, unknown>;
  /** Default ElevenLabs voice stability (0..1) for this host. Lower = more expressive/variable, higher = more consistent. */
  defaultStability?: number;
  /**
   * Free-text voice direction (Gemini's natural-language style). Emitted as an audio
   * tag `[...]` so the model interprets it instead of speaking it.
   */
  defaultStyle?: string;
  /** Mirror this host's face horizontally (so a portrait can face either side of the layout). */
  flip?: boolean;
}

/** Derived from a host's `model` prefix. */
export function providerOf(host: Pick<Host, "model">): ProviderId {
  const slash = host.model.indexOf("/");
  return slash > 0 ? host.model.slice(0, slash) : "unknown";
}

export interface ConversationConfig {
  topic: string;
  /** Tone / format guidance, e.g. "playful, debate-style, lots of concrete examples". */
  styleNote?: string;
  /** Approx number of back-and-forth turns the script should aim for. */
  targetTurns?: number;
  /** Cap each turn's length (words). Low values (~12-16) make punchy short clips. */
  maxWordsPerTurn?: number;
  hosts: [Host, Host];
  language?: string;
  aspectRatio?: AspectRatio;
  /** Override pipeline model ids / quality knobs. */
  options?: Partial<PipelineOptions>;
}

export interface PipelineOptions {
  /**
   * Which animation backend.
   * - `replicate-p-video` (default): Replicate's Pruna AI p-video — one clip per
   *   turn, lip-synced to that turn's real audio. Cheaper/faster.
   * - `fal-ltx`: fal LTX-2.3 audio-to-video — same per-turn shape, higher-quality
   *   alternative with more natural variety.
   */
  videoProvider: "fal-ltx" | "replicate-p-video";
  /** Gemini text model for script writing. */
  scriptModel: string;
  /** Gemini text model for cheap structured cue analysis. */
  cueModel: string;
  /** Gemini image model for host stills (Nano Banana 2 — face quality matters here). */
  imageModel: string;
  /** Gemini image model for b-roll images (Nano Banana 2 Lite — fast + cheap, ~$0.034/image). */
  brollImageModel: string;
  /** fal audio-to-video model id. */
  falVideoModel: string;
  /** Replicate audio-to-video model id (owner/name). */
  replicateVideoModel: string;
  /** Generation + render resolution. */
  videoResolution: "720p" | "1080p";
  /** Silence between conversation turns, ms. */
  gapMs: number;
  /** Hard ceiling on b-roll/overlay cues (the effective budget is also capped at ~1.5/min). */
  maxCues: number;
  /** Final render quality. */
  renderQuality: "draft" | "standard" | "high";
  /** Final render fps. */
  fps: 24 | 30;
  /** Caption visual style. */
  captionStyle: CaptionStyle;
  /** Primary caption color (hex) — the highlight/pill/glow color. */
  captionColor: string;
  /** Max per-turn lip-sync clips to generate in parallel (fal). Keep modest to avoid rate limits. */
  videoConcurrency: number;
}

/** Provider-neutral voice direction for a line; compiled per provider at speech time. */
export interface Performance {
  /** ElevenLabs voice_settings.stability override for this line (0..1). */
  stability?: number;
}

export interface ScriptTurn {
  index: number;
  hostId: string;
  speaker: string;
  text: string;
  /** Voice direction (per-line stability override) for this line. */
  performance?: Performance;
}

export interface Script {
  topic: string;
  title: string;
  /** One-line hook used for the title card. */
  hook: string;
  turns: ScriptTurn[];
}

/** Word-level alignment, seconds. Mirrors @speech-sdk/core WordTimestamp. */
export interface WordTs {
  text: string;
  start: number;
  end: number;
  /** 0-based index into the input turns[] (conversations only). */
  turnIndex?: number;
}

/** One turn's standalone audio + its place on the master timeline. */
export interface TurnRegion {
  turnIndex: number;
  hostId: string;
  speaker: string;
  /** ABSOLUTE start on the master timeline (cumulative across prior turns). */
  start: number;
  /** ABSOLUTE end = start + durationSec. */
  end: number;
  text: string;
  /** Word alignment in ABSOLUTE seconds (relative-to-turn + start). */
  words: WordTs[];
  /** 1+ animation segments (each ≤ the LTX clip cap), fed directly to the animator. */
  segments: { audioPath: string; durationSec: number }[];
  mediaType: string;
  /** This turn's total audio duration (sum of segments, incl. the baked-in pause). */
  durationSec: number;
}

export interface SpeechArtifact {
  /** Project-rel path to the DERIVED master audio (concat of the per-turn files) — playback/compose only. */
  audioPath: string;
  mediaType: string;
  durationSec: number;
  words: WordTs[];
  turns: TurnRegion[];
  /** Inter-turn pause (ms) baked into each non-final turn's audio. Recorded for deterministic rebuilds. */
  gapMs?: number;
}

export interface HostAvatarImage {
  /** Project-relative base avatar image used as the first frame for video generation. */
  imagePath: string;
}

export interface AvatarImagesArtifact {
  /** Per-host base avatar images, keyed by host id. */
  hosts: Record<string, HostAvatarImage>;
}

export type ClipRole = "avatar";

export interface ClipAsset {
  id: string;
  role: ClipRole;
  /** Host id for avatar clips. */
  hostId?: string;
  /** Set on bespoke per-turn clips (per-turn / hybrid strategies). */
  turnIndex?: number;
  /** Segment index within a turn (0 unless a long turn was split into multiple clips). */
  segIndex?: number;
  /** Path (relative to project dir) to the mp4. */
  path: string;
  durationSec: number;
  /** Seconds to remove from the clip head when composing. Original generated MP4 is kept. */
  trimStartSec?: number;
  /** Seconds to remove from the clip tail when composing. Original generated MP4 is kept. */
  trimEndSec?: number;
  /** Base avatar image this clip animated from. */
  sourceImage: string;
}

export interface ClipLibrary {
  clips: ClipAsset[];
}

export type CueType = "broll" | "lower-third" | "stat" | "quote";

export interface Cue {
  id: string;
  start: number;
  end: number;
  type: CueType;
  /** Headline text (lower-third / stat / quote). */
  title?: string;
  /** Supporting line. */
  subtitle?: string;
  /** For `stat`: the big number/figure. */
  figure?: string;
  /** For `broll`: prompt used to generate the supporting image. */
  imagePrompt?: string;
  /** Filled after image generation (relative path). */
  imagePath?: string;
  /** Which host this cue supports, for color + attribution. */
  hostId?: string;
}

export interface BrollPlan {
  cues: Cue[];
}

export interface CompositionArtifact {
  /** Directory of the assembled HyperFrames project (relative to project dir). */
  dir: string;
  indexPath: string;
  width: number;
  height: number;
  durationSec: number;
}

export interface OutputArtifact {
  videoPath: string;
  durationSec: number;
  bytes: number;
}

export type StageName =
  | "script"
  | "speech"
  | "stills"
  | "video"
  | "broll"
  | "compose"
  | "render";

export interface StageRecord {
  status: "pending" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Free-form per-stage notes (model used, costs, counts). */
  notes?: Record<string, unknown>;
}

export interface ProjectState {
  /** On-disk schema version (see SCHEMA_VERSION in shared.ts). Mismatched
   *  projects are refused with a clear error — there is no migration path. */
  schemaVersion: number;
  slug: string;
  createdAt: string;
  updatedAt: string;
  config: ConversationConfig;
  options: PipelineOptions;
  stages: Partial<Record<StageName, StageRecord>>;

  // Artifacts, filled stage by stage.
  script?: Script;
  speech?: SpeechArtifact;
  stills?: AvatarImagesArtifact;
  clips?: ClipLibrary;
  broll?: BrollPlan;
  composition?: CompositionArtifact;
  output?: OutputArtifact;

  /**
   * User-uploaded reference photos, keyed by host id → project-relative path
   * (e.g. `stills/host_a-base.png`). When present, the stills stage uses the
   * upload as that host's base avatar image instead of generating one. Never
   * deleted by a stills-stage invalidation.
   */
  uploads?: Record<string, string>;
}

/** Typed per-clip progress rider on video-stage events (the studio's live clip rail). */
export interface ClipProgress {
  turnIndex: number;
  segIndex: number;
  hostId: string;
  status: "rendering" | "done";
  /** Project-relative clip path, present once status = done. */
  path?: string;
  durationSec?: number;
  /** Total clips in this run. */
  total: number;
}

/** Progress event emitted throughout a run (consumed by the web app SSE). */
export interface PipelineEvent {
  stage: StageName | "pipeline";
  level: "info" | "warn" | "error" | "success";
  message: string;
  /** 0..1 within the stage, if known. */
  progress?: number;
  at: string;
  data?: Record<string, unknown>;
  /** Structured per-clip progress (video stage only). */
  clip?: ClipProgress;
}

export type ProgressHandler = (event: PipelineEvent) => void;
