/**
 * @podframes/core — topic → animated AI podcast video.
 *
 * Pipeline: script (Gemini) → speech (Speechbase multi-provider conversation) →
 * stills/base avatars → video (P-Video or LTX) → b-roll cues (Gemini) →
 * compose (HyperFrames HTML) → render (MP4).
 */

export { generate, generateProject, missingKeys, STAGES, STAGE_NAMES } from "./pipeline";
export type { GenerateOptions } from "./pipeline";

export { Project } from "./project";
export { slugify, slugForTopic, contentHash } from "./util/fs";
export { validateConfig, validateOptions } from "./validate";
export {
  DEFAULT_OPTIONS,
  DEFAULT_HOSTS,
  MODELS,
  mergeOptions,
  resolveEnv,
  ensureEnvLoaded,
} from "./config";
export type { ResolvedEnv } from "./config";

// Pure constants shared with the browser — also importable directly (without
// the node-only pipeline) via "@podframes/core/shared".
export {
  SCHEMA_VERSION,
  BRAND,
  PROVIDER_COLORS,
  PROVIDER_COLOR_FALLBACK,
  providerColor,
  CAPTION_STYLE_PRESETS,
  CANVAS,
  VIDEO_PROVIDERS,
} from "./shared";
export type { VideoProviderId } from "./shared";

export { providerOf } from "./types";
export type {
  AspectRatio,
  CaptionStyle,
  ProviderId,
  Host,
  ConversationConfig,
  PipelineOptions,
  Script,
  ScriptTurn,
  Performance,
  WordTs,
  TurnRegion,
  SpeechArtifact,
  AvatarImagesArtifact,
  HostAvatarImage,
  ClipAsset,
  ClipLibrary,
  Cue,
  CueType,
  BrollPlan,
  CompositionArtifact,
  OutputArtifact,
  StageName,
  StageRecord,
  ProjectState,
  PipelineEvent,
  ClipProgress,
  ProgressHandler,
} from "./types";

export { buildCaptionGroups } from "./compose/captions";
export type { CaptionGroup } from "./compose/captions";

// Editing helpers (web studio: invalidate stages after an edit)
export { clearStages, clearTurnClips, clearSpeechTurns, STAGE_ARTIFACTS, INVALIDATION } from "./editing";

// Per-project write coordination (prevents concurrent edits/runs from corrupting project.json)
export { withProjectLock, isProjectBusy, isRunActive, runLockFile } from "./util/lock";
export { brollImagePrompt, brollImagePath } from "./stages/broll";
export { castHost } from "./stages/stills";

// Performance direction (inline audio tags + ElevenLabs stability)
export { compilePerformance, isAudioTagWord } from "./performance";

// Clients (for advanced / direct usage)
export { GeminiClient } from "./clients/gemini";
export { synthesizeConversation, synthesizeOne, synthesizeTurn } from "./clients/speechbase";
