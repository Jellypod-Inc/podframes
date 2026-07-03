import { test } from "node:test";
import assert from "node:assert/strict";
import {
  offsetWords,
  buildTurnRegions,
  planBaseTrack,
  planSegmentBoundaries,
  type SynthesizedTurn,
} from "./turn-timing";
import type { WordTs } from "../types";

const r2 = (n: number): number => Math.round(n * 100) / 100;
const w = (text: string, start: number, end: number): WordTs => ({ text, start, end });

function mkTurn(i: number, segDurations: number[], words: WordTs[]): SynthesizedTurn {
  return {
    turnIndex: i,
    hostId: i % 2 === 0 ? "host_a" : "host_b",
    speaker: i % 2 === 0 ? "S1" : "S2",
    text: words.map((x) => x.text).join(" "),
    segments: segDurations.map((d, k) => ({ audioPath: `audio/turn-${i}-${k}.mp3`, durationSec: d })),
    words,
  };
}

test("offsetWords shifts to absolute, preserving order and span", () => {
  const abs = offsetWords([w("a", 0, 0.5), w("b", 0.5, 1.0)], 3.2);
  assert.deepEqual(abs.map((x) => [x.start, x.end]), [[3.2, 3.7], [3.7, 4.2]]);
});

test("buildTurnRegions: cumulative offsets, contiguous, no gaps/overlaps", () => {
  const turns = [
    mkTurn(0, [2.0], [w("hi", 0, 1.5)]),
    mkTurn(1, [3.0], [w("yo", 0, 2.4)]),
    mkTurn(2, [1.5], [w("ok", 0, 1.0)]),
  ];
  const { regions, durationSec } = buildTurnRegions(turns);
  assert.deepEqual(regions.map((r) => r.start), [0, 2.0, 5.0]);
  assert.deepEqual(regions.map((r) => r.end), [2.0, 5.0, 6.5]);
  assert.equal(durationSec, 6.5);
  for (let i = 1; i < regions.length; i++) assert.equal(regions[i]!.start, regions[i - 1]!.end, `region ${i} contiguous`);
});

test("buildTurnRegions: a multi-segment turn's durationSec is the sum of its segments", () => {
  const turns = [mkTurn(0, [10, 8], [w("long", 0, 17)]), mkTurn(1, [2], [w("short", 0, 1.5)])];
  const { regions } = buildTurnRegions(turns);
  assert.equal(regions[0]!.durationSec, 18);
  assert.equal(regions[0]!.segments.length, 2);
  assert.equal(regions[1]!.start, 18); // turn 1 starts after turn 0's full 18s
});

test("buildTurnRegions: words land inside their region's absolute window", () => {
  const { regions } = buildTurnRegions([mkTurn(0, [2.0], [w("a", 0, 1.0)]), mkTurn(1, [2.0], [w("b", 0.1, 1.2)])]);
  assert.deepEqual([regions[1]!.words[0]!.start, regions[1]!.words[0]!.end], [2.1, 3.2]);
});

test("buildTurnRegions: N turns → N regions even without turnIndex on words (collapse bug gone)", () => {
  const turns = [mkTurn(0, [1], [w("a", 0, 0.9)]), mkTurn(1, [1], [w("b", 0, 0.9)]), mkTurn(2, [1], [w("c", 0, 0.9)])];
  assert.equal(buildTurnRegions(turns).regions.length, 3);
});

test("buildTurnRegions: input order independent (sorts by turnIndex)", () => {
  const turns = [mkTurn(2, [1], [w("c", 0, 0.5)]), mkTurn(0, [1], [w("a", 0, 0.5)]), mkTurn(1, [1], [w("b", 0, 0.5)])];
  assert.deepEqual(buildTurnRegions(turns).regions.map((r) => r.turnIndex), [0, 1, 2]);
});

test("planBaseTrack: contiguity invariant tile[i+1].start === r2(tile[i].start + tile[i].duration)", () => {
  const tiles = planBaseTrack([2.0, 3.13, 1.07], 6.2);
  for (let i = 1; i < tiles.length; i++) assert.equal(tiles[i]!.start, r2(tiles[i - 1]!.start + tiles[i - 1]!.duration));
});

test("planBaseTrack: full coverage — last tile reaches totalDurationSec", () => {
  const tiles = planBaseTrack([2.0, 3.0, 1.4], 6.4);
  const last = tiles[tiles.length - 1]!;
  assert.equal(r2(last.start + last.duration), 6.4);
});

test("planBaseTrack: single segment covers the whole timeline", () => {
  const tiles = planBaseTrack([4.2], 4.2);
  assert.deepEqual(tiles, [{ start: 0, duration: 4.2 }]);
});

test("planSegmentBoundaries: a short turn is one segment", () => {
  assert.deepEqual(planSegmentBoundaries([w("a", 0, 4)], 5, 18), [0, 5]);
});

test("planSegmentBoundaries: a long turn splits at word gaps, every segment <= maxSec", () => {
  const words = Array.from({ length: 40 }, (_, k) => w(`w${k}`, k, k + 0.8)); // ~40s
  const bounds = planSegmentBoundaries(words, 40, 18);
  assert.ok(bounds.length > 2, `expected multiple segments (got ${bounds.length - 1})`);
  assert.equal(bounds[0], 0);
  assert.equal(bounds[bounds.length - 1], 40);
  for (let i = 1; i < bounds.length; i++) {
    assert.ok(bounds[i]! - bounds[i - 1]! <= 18 + 1e-9, `segment ${i} (${(bounds[i]! - bounds[i - 1]!).toFixed(2)}s) <= 18s`);
  }
});

test("planSegmentBoundaries: no word timing falls back to fixed-interval cuts", () => {
  const bounds = planSegmentBoundaries([], 40, 18);
  assert.deepEqual(bounds, [0, 18, 36, 40]);
  for (let i = 1; i < bounds.length; i++) assert.ok(bounds[i]! - bounds[i - 1]! <= 18 + 1e-9);
});

test("planSegmentBoundaries: audio outlasting the last word still respects the cap", () => {
  // Words end at ~25.8s but the audio runs to 40s (trailing tag noise/silence):
  // the residual span must be cut too, never a 22s final segment over the cap.
  const words = Array.from({ length: 26 }, (_, k) => w(`w${k}`, k, k + 0.8));
  const bounds = planSegmentBoundaries(words, 40, 18);
  assert.equal(bounds[0], 0);
  assert.equal(bounds[bounds.length - 1], 40);
  for (let i = 1; i < bounds.length; i++) {
    assert.ok(
      bounds[i]! - bounds[i - 1]! <= 18 + 1e-9,
      `segment ${i} (${(bounds[i]! - bounds[i - 1]!).toFixed(2)}s) exceeds the 18s cap`,
    );
  }
});
