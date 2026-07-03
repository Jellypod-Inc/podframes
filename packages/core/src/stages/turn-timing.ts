import type { TurnRegion, WordTs } from "../types";

/**
 * Pure timing math for per-turn standalone speech. Side-effect-free so the
 * alignment invariants (cumulative offsets, gapless tiling, ≤cap segments) are
 * unit tested — the guardrail against the black-frame / freeze / gap bugs.
 *
 * MODEL: each turn is synthesized as its own audio with the inter-turn pause baked
 * in. A long turn is split into 1+ SEGMENTS (each ≤ the animator's clip cap), cut
 * at word gaps; each segment is one LTX clip. The master is a PURE concat of all
 * segments in order, so a turn's absolute start is the running sum of durations.
 */

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** One animation segment of a turn (one LTX clip). */
export interface TurnSegment {
  audioPath: string;
  durationSec: number;
}

/** One synthesized turn before it's placed on the absolute timeline. */
export interface SynthesizedTurn {
  turnIndex: number;
  hostId: string;
  speaker: string;
  text: string;
  /** 1+ animation segments (LTX-capped), in order. */
  segments: TurnSegment[];
  /** Word alignment RELATIVE to this turn's audio (starts ~0). */
  words: WordTs[];
}

/** Shift relative word timings into absolute by an offset (seconds). */
export function offsetWords(words: WordTs[], offset: number): WordTs[] {
  return words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
}

/**
 * Split a turn into segment boundaries (seconds) so each segment's span ≤ maxSec,
 * cutting at the gap between words (never mid-word). Returns [0, ...cuts, durationSec].
 * Falls back to fixed-interval cuts when there's no word timing.
 */
export function planSegmentBoundaries(words: WordTs[], durationSec: number, maxSec: number): number[] {
  if (durationSec <= maxSec) return [0, durationSec];
  const cuts: number[] = [];
  let segStart = 0;
  if (words.length > 0) {
    for (let i = 1; i < words.length; i++) {
      if (words[i]!.end - segStart > maxSec) {
        const cut = (words[i - 1]!.end + words[i]!.start) / 2; // midpoint of the gap
        if (cut > segStart + 0.1 && cut < durationSec - 0.1) {
          cuts.push(cut);
          segStart = cut;
        }
      }
    }
  }
  // Fixed-interval cuts for any residual span the word-gap loop can't see: the
  // no-words case, AND audio that outlasts the last word (trailing tag noise /
  // silence) — otherwise the final segment can exceed the animator's clip cap.
  while (durationSec - segStart > maxSec) {
    const cut = segStart + maxSec;
    if (cut >= durationSec - 0.1) break;
    cuts.push(cut);
    segStart = cut;
  }
  return [0, ...cuts, durationSec];
}

/**
 * Place standalone turns on one timeline with cumulative offsets. Because each
 * turn's audio already contains its trailing pause, offsets are a plain running
 * sum — region[i].end === region[i+1].start exactly (no holes, no overlaps).
 */
export function buildTurnRegions(turns: SynthesizedTurn[]): { regions: TurnRegion[]; durationSec: number } {
  const sorted = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const regions: TurnRegion[] = [];
  let cursor = 0;
  for (const t of sorted) {
    const durationSec = t.segments.reduce((s, x) => s + x.durationSec, 0);
    const start = cursor;
    regions.push({
      turnIndex: t.turnIndex,
      hostId: t.hostId,
      speaker: t.speaker,
      start,
      end: start + durationSec,
      text: t.text,
      words: offsetWords(t.words, start),
      mediaType: "audio/mpeg",
      durationSec,
      segments: t.segments,
    });
    cursor = start + durationSec;
  }
  return { regions, durationSec: cursor };
}

export interface BaseTile {
  start: number;
  duration: number;
}

/**
 * Tile the base video track from per-segment durations with ONE cumulative cursor,
 * so tile[i+1].start === r2(tile[i].start + tile[i].duration) EXACTLY (contiguity —
 * no black seams). The final tile extends to totalDurationSec to absorb rounding.
 */
export function planBaseTrack(durations: number[], totalDurationSec: number): BaseTile[] {
  const tiles: BaseTile[] = [];
  let cursor = 0;
  for (let i = 0; i < durations.length; i++) {
    const isLast = i === durations.length - 1;
    const end = isLast ? r2(totalDurationSec) : r2(cursor + Math.max(0, durations[i]!));
    const duration = r2(Math.max(0.3, end - cursor));
    tiles.push({ start: cursor, duration });
    cursor = r2(cursor + duration);
  }
  return tiles;
}
