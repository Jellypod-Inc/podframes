import { generateConversation, generateSpeech } from "@speech-sdk/core";
import type { WordTs } from "../types";

export interface SpeechbaseTurn {
  /** `provider/model`, e.g. `openai/gpt-4o-mini-tts`. */
  model: string;
  /** Provider voice id. */
  voice: string;
  text: string;
  /** Provider-specific tuning (e.g. ElevenLabs voice_settings). */
  providerOptions?: Record<string, unknown>;
}

export interface ConversationArgs {
  turns: SpeechbaseTurn[];
  /** Gateway key. When omitted, @speech-sdk/core uses direct per-provider env keys. */
  apiKey?: string;
  gapMs?: number;
  volumeDbfs?: number;
  maxConcurrency?: number;
}

export interface ConversationOutput {
  audio: Uint8Array;
  mediaType: string;
  /** Word-level alignment in seconds, each tagged with its turnIndex. */
  words: WordTs[];
  durationMs?: number;
  warnings: string[];
}

/** File extension for an audio mediaType. */
export function extForMediaType(mediaType: string): "mp3" | "wav" | "ogg" | "bin" {
  if (mediaType.includes("mpeg") || mediaType.includes("mp3")) return "mp3";
  if (mediaType.includes("wav")) return "wav";
  if (mediaType.includes("ogg")) return "ogg";
  return "bin";
}

/**
 * Synthesize a multi-speaker conversation through Speechbase with word-level
 * timestamps. Different turns may use different providers/voices — that is the
 * whole point of the showcase.
 */
export async function synthesizeConversation(args: ConversationArgs): Promise<ConversationOutput> {
  const result = (await generateConversation({
    turns: args.turns.map((t) => ({
      model: t.model,
      voice: t.voice,
      text: t.text,
      ...(t.providerOptions ? { providerOptions: t.providerOptions } : {}),
    })),
    timestamps: true,
    gapMs: args.gapMs ?? 320,
    volumeDbfs: args.volumeDbfs ?? -18,
    maxConcurrency: args.maxConcurrency ?? 6,
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
  } as never)) as ConversationResultLike;

  const audio = result.audio?.uint8Array;
  if (!audio) throw new Error("Speechbase returned no audio");

  const words: WordTs[] = (result.timestamps ?? []).map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    ...(w.turnIndex != null ? { turnIndex: w.turnIndex } : {}),
  }));

  return {
    audio,
    mediaType: result.audio?.mediaType ?? "audio/mpeg",
    words,
    durationMs: result.metadata?.audioDurationMs,
    warnings: result.warnings ?? [],
  };
}

/**
 * Single-voice TTS WITH word-level timestamps — the per-turn synth primitive.
 * Returns words RELATIVE to this turn's audio (starting ~0, no turnIndex). Each turn
 * is synthesized standalone and fed directly to the animator (no master-slicing).
 */
export async function synthesizeTurn(args: {
  model: string;
  voice: string;
  text: string;
  providerOptions?: Record<string, unknown>;
  apiKey?: string;
  volumeDbfs?: number;
}): Promise<{ audio: Uint8Array; mediaType: string; words: WordTs[] }> {
  const result = (await generateSpeech({
    model: args.model,
    voice: args.voice,
    text: args.text,
    timestamps: true,
    volumeDbfs: args.volumeDbfs ?? -18,
    ...(args.providerOptions ? { providerOptions: args.providerOptions } : {}),
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
  } as never)) as {
    audio?: { uint8Array: Uint8Array; mediaType: string };
    timestamps?: Array<{ text: string; start: number; end: number }>;
  };
  const audio = result.audio?.uint8Array;
  if (!audio) throw new Error("Speechbase returned no audio");
  const words: WordTs[] = (result.timestamps ?? []).map((t) => ({ text: t.text, start: t.start, end: t.end }));
  return { audio, mediaType: result.audio?.mediaType ?? "audio/mpeg", words };
}

/** Single-voice TTS (one speaker) — used for quick voice previews. Unlike the
 *  conversation API, this works for a single Google voice. */
export async function synthesizeOne(args: {
  model: string;
  voice: string;
  text: string;
  providerOptions?: Record<string, unknown>;
  apiKey?: string;
}): Promise<{ audio: Uint8Array; mediaType: string }> {
  const result = (await generateSpeech({
    model: args.model,
    voice: args.voice,
    text: args.text,
    ...(args.providerOptions ? { providerOptions: args.providerOptions } : {}),
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
  } as never)) as { audio?: { uint8Array: Uint8Array; mediaType: string } };
  const audio = result.audio?.uint8Array;
  if (!audio) throw new Error("Speechbase returned no audio");
  return { audio, mediaType: result.audio?.mediaType ?? "audio/mpeg" };
}

// Structural shape of the @speech-sdk/core result (kept local to avoid coupling to internal types).
interface ConversationResultLike {
  audio?: { uint8Array: Uint8Array; base64: string; mediaType: string };
  metadata?: { audioDurationMs?: number };
  timestamps?: Array<{ text: string; start: number; end: number; turnIndex?: number }>;
  warnings?: string[];
}
