import { DEFAULT_OPTIONS } from "./config";
import { CAPTION_STYLE_PRESETS, VIDEO_PROVIDERS, VISUAL_TREATMENTS } from "./shared";
import type { ConversationConfig, Host, PipelineOptions } from "./types";

/**
 * Validate an untrusted {@link ConversationConfig} BEFORE any API spend. Both
 * entry points funnel through this: the CLI's `--config` JSON and the web
 * studio's request bodies are blind-cast, so this is the one runtime guard.
 * Plain asserts, no schema library — the error message is the interface.
 */
export function validateConfig(config: ConversationConfig): void {
  const fail = (msg: string): never => {
    throw new Error(`invalid config: ${msg}`);
  };

  if (!config || typeof config !== "object") fail("expected an object");
  if (typeof config.topic !== "string" || !config.topic.trim()) fail("topic must be a non-empty string");

  if (!Array.isArray(config.hosts) || config.hosts.length !== 2) {
    fail(`hosts must be exactly [hostA, hostB] (got ${Array.isArray(config.hosts) ? config.hosts.length : typeof config.hosts})`);
  }
  config.hosts.forEach((h, i) => validateHost(h, i, fail));
  if (config.hosts[0].id === config.hosts[1].id) fail("hosts must have distinct ids");

  if (config.targetTurns != null && !(Number.isFinite(config.targetTurns) && config.targetTurns >= 2 && config.targetTurns <= 60)) {
    fail(`targetTurns must be 2–60 (got ${config.targetTurns})`);
  }
  if (config.maxWordsPerTurn != null && !(Number.isFinite(config.maxWordsPerTurn) && config.maxWordsPerTurn >= 4 && config.maxWordsPerTurn <= 80)) {
    fail(`maxWordsPerTurn must be 4–80 (got ${config.maxWordsPerTurn})`);
  }
  if (config.aspectRatio != null && config.aspectRatio !== "16:9" && config.aspectRatio !== "9:16") {
    fail(`aspectRatio must be "16:9" or "9:16" (got "${config.aspectRatio}")`);
  }
  if (config.options != null) validateOptions(config.options, fail);
}

function validateHost(h: Host, i: number, fail: (msg: string) => never): void {
  const at = `hosts[${i}]`;
  if (!h || typeof h !== "object") fail(`${at} must be an object`);
  for (const key of ["id", "name", "speaker", "model", "voice"] as const) {
    if (typeof h[key] !== "string" || !h[key].trim()) fail(`${at}.${key} must be a non-empty string`);
  }
  if (!h.model.includes("/")) fail(`${at}.model must be "provider/model" (got "${h.model}")`);
  if (h.side !== "left" && h.side !== "right") fail(`${at}.side must be "left" or "right"`);
  if (h.defaultStability != null && !(Number.isFinite(h.defaultStability) && h.defaultStability >= 0 && h.defaultStability <= 1)) {
    fail(`${at}.defaultStability must be 0–1`);
  }
}

/** Validate PipelineOptions overrides: unknown keys are rejected (they are
 *  always a typo — every real knob has a default in DEFAULT_OPTIONS). */
export function validateOptions(options: Partial<PipelineOptions>, fail?: (msg: string) => never): void {
  const raise =
    fail ??
    ((msg: string): never => {
      throw new Error(`invalid options: ${msg}`);
    });
  const known = new Set(Object.keys(DEFAULT_OPTIONS));
  for (const key of Object.keys(options)) {
    if (!known.has(key)) raise(`unknown option "${key}" (valid: ${[...known].join(", ")})`);
  }
  const o = options;
  const oneOf = <T,>(name: string, value: T | undefined, allowed: readonly T[]): void => {
    if (value != null && !allowed.includes(value)) {
      raise(`${name} must be one of ${allowed.join(" | ")} (got "${String(value)}")`);
    }
  };
  const inRange = (name: string, value: number | undefined, min: number, max: number): void => {
    if (value != null && !(Number.isFinite(value) && value >= min && value <= max)) {
      raise(`${name} must be ${min}–${max} (got ${String(value)})`);
    }
  };
  oneOf("videoProvider", o.videoProvider, VIDEO_PROVIDERS.map((p) => p.id));
  oneOf("videoResolution", o.videoResolution, ["720p", "1080p"] as const);
  oneOf("renderQuality", o.renderQuality, ["draft", "standard", "high"] as const);
  oneOf("fps", o.fps, [24, 30] as const);
  oneOf("captionStyle", o.captionStyle, CAPTION_STYLE_PRESETS.map((p) => p.id));
  oneOf("visualTreatment", o.visualTreatment, VISUAL_TREATMENTS.map((p) => p.id));
  inRange("gapMs", o.gapMs, 0, 5000);
  inRange("maxCues", o.maxCues, 0, 20);
  inRange("videoConcurrency", o.videoConcurrency, 1, 8);
  if (o.captionColor != null && !/^#[0-9a-fA-F]{6}$/.test(o.captionColor)) {
    raise(`captionColor must be a #RRGGBB hex (got "${o.captionColor}")`);
  }
}
