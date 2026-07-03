import { providerOf } from "./types";
import type { Host, ScriptTurn } from "./types";

/**
 * Performance direction → provider-native encoding.
 *
 * Tone, emphasis, and reactions are authored as inline `[tag]` audio tags written
 * straight into the script text (e.g. "[excited] That's the point." / "[laughs]").
 * Both models we support read these natively (verified: neither ElevenLabs v3 nor
 * Gemini 3.1 vocalizes them), and @speech-sdk/core routes tags per-provider. The
 * only host-level direction is the Gemini free-text style; ElevenLabs additionally
 * honors `voice_settings.stability`. There is no managed delivery/reaction field.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ElevenLabs voice stability used when a host hasn't picked one. */
export const DEFAULT_STABILITY = 0.5;

/**
 * Compile a turn into the text + providerOptions sent to Speechbase. The text is
 * returned untouched unless the host has a Gemini style direction; stability is
 * applied for ElevenLabs hosts. Inline tags the author wrote into the text pass
 * straight through.
 */
export function compilePerformance(
  host: Host,
  turn: ScriptTurn,
): { text: string; providerOptions?: Record<string, unknown> } {
  const perf = turn.performance;
  const stability = perf?.stability ?? host.defaultStability ?? DEFAULT_STABILITY;
  // The only host-level tag is Gemini's free-text style direction (interpreted by
  // the model, NOT spoken). Per-line tone/reactions live in the script text itself.
  const tag = host.defaultStyle?.trim() ? `[${host.defaultStyle.trim().replace(/[[\]]/g, "")}]` : undefined;
  const body = turn.text.trim();
  const compiled = [tag, body].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const hasTag = !!tag;

  // ElevenLabs: pass the host's chosen stability straight through to voice_settings — no derived knobs.
  let providerOptions: Record<string, unknown> | undefined;
  const isEleven = providerOf(host) === "elevenlabs";
  const stabilitySet = perf?.stability != null || host.defaultStability != null;
  if (isEleven && (hasTag || stabilitySet)) {
    const existing = (host.providerOptions?.voice_settings as Record<string, unknown>) ?? {};
    providerOptions = {
      ...host.providerOptions,
      voice_settings: {
        similarity_boost: 0.8,
        use_speaker_boost: true,
        ...existing,
        stability: r2(Math.max(0, Math.min(1, stability))),
      },
    };
  }

  if (!hasTag && !providerOptions) return { text: turn.text };
  return { text: hasTag ? compiled : turn.text, ...(providerOptions ? { providerOptions } : {}) };
}

/** A timestamp word is an audio tag (e.g. "[laughs]") that must not appear in captions. */
export const isAudioTagWord = (text: string): boolean => /^\[[^\]]+\]$/.test(text.trim());
