import type { ClipAsset, Cue, TurnRegion, WordTs } from "../types";

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface TrimmedSegment {
  turnIndex: number;
  segIndex: number;
  audioPath: string;
  originalDurationSec: number;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

export interface TrimmedTimeline {
  turns: TurnRegion[];
  segments: TrimmedSegment[];
  durationSec: number;
  hasTrim: boolean;
}

function trimForSegment(clips: ClipAsset[], turnIndex: number, segIndex: number): Pick<ClipAsset, "trimStartSec" | "trimEndSec"> | undefined {
  return clips.find((clip) => clip.turnIndex === turnIndex && (clip.segIndex ?? 0) === segIndex);
}

function mapWordThroughSegment(word: WordTs, seg: TrimmedSegment): WordTs | null {
  if (word.end <= seg.oldStart || word.start >= seg.oldEnd) return null;
  const start = Math.max(word.start, seg.oldStart);
  const end = Math.min(word.end, seg.oldEnd);
  if (end - start <= 0.01) return null;
  return {
    ...word,
    start: r2(seg.newStart + (start - seg.oldStart)),
    end: r2(seg.newStart + (end - seg.oldStart)),
  };
}

export function buildTrimmedTimeline(turns: TurnRegion[], clips: ClipAsset[]): TrimmedTimeline {
  const outTurns: TurnRegion[] = [];
  const outSegments: TrimmedSegment[] = [];
  let cursor = 0;
  let hasTrim = false;

  for (const turn of turns) {
    let oldLocal = 0;
    let newLocal = 0;
    const turnSegments: TurnRegion["segments"] = [];
    const segmentViews: TrimmedSegment[] = [];

    for (let segIndex = 0; segIndex < turn.segments.length; segIndex++) {
      const seg = turn.segments[segIndex]!;
      const clip = trimForSegment(clips, turn.turnIndex, segIndex);
      const rawStart = Math.max(0, clip?.trimStartSec ?? 0);
      const rawEnd = Math.max(0, clip?.trimEndSec ?? 0);
      const trimStartSec = r2(Math.min(rawStart, Math.max(0, seg.durationSec - 0.05)));
      const trimEndSec = r2(Math.min(rawEnd, Math.max(0, seg.durationSec - trimStartSec - 0.05)));
      const durationSec = r2(Math.max(0.05, seg.durationSec - trimStartSec - trimEndSec));
      if (trimStartSec > 0 || trimEndSec > 0) hasTrim = true;

      const trimmed: TrimmedSegment = {
        turnIndex: turn.turnIndex,
        segIndex,
        audioPath: seg.audioPath,
        originalDurationSec: seg.durationSec,
        durationSec,
        trimStartSec,
        trimEndSec,
        sourceStartSec: trimStartSec,
        sourceEndSec: r2(seg.durationSec - trimEndSec),
        oldStart: r2(turn.start + oldLocal + trimStartSec),
        oldEnd: r2(turn.start + oldLocal + seg.durationSec - trimEndSec),
        newStart: r2(cursor + newLocal),
        newEnd: r2(cursor + newLocal + durationSec),
      };
      segmentViews.push(trimmed);
      outSegments.push(trimmed);
      turnSegments.push({ ...seg, durationSec });
      oldLocal = r2(oldLocal + seg.durationSec);
      newLocal = r2(newLocal + durationSec);
    }

    const words = turn.words
      .flatMap((word) => segmentViews.map((seg) => mapWordThroughSegment(word, seg)).filter((w): w is WordTs => !!w))
      .sort((a, b) => a.start - b.start);
    outTurns.push({
      ...turn,
      start: cursor,
      end: r2(cursor + newLocal),
      durationSec: newLocal,
      words,
      segments: turnSegments,
    });
    cursor = r2(cursor + newLocal);
  }

  return { turns: outTurns, segments: outSegments, durationSec: cursor, hasTrim };
}

export function mapSourceTimeToTrimmed(segments: TrimmedSegment[], sourceTime: number): number {
  if (segments.length === 0) return Math.max(0, sourceTime);
  for (const seg of segments) {
    if (sourceTime < seg.oldStart) return seg.newStart;
    if (sourceTime <= seg.oldEnd) return r2(seg.newStart + (sourceTime - seg.oldStart));
  }
  return segments[segments.length - 1]!.newEnd;
}

export function mapTrimmedTimeToSource(segments: TrimmedSegment[], trimmedTime: number): number {
  if (segments.length === 0) return Math.max(0, trimmedTime);
  for (const seg of segments) {
    if (trimmedTime < seg.newStart) return seg.oldStart;
    if (trimmedTime <= seg.newEnd) return r2(seg.oldStart + (trimmedTime - seg.newStart));
  }
  return segments[segments.length - 1]!.oldEnd;
}

export function mapCuesToTrimmedTimeline(cues: Cue[], segments: TrimmedSegment[], durationSec: number): Cue[] {
  if (segments.length === 0) return cues;
  return cues.flatMap((cue) => {
    const start = Math.min(durationSec, mapSourceTimeToTrimmed(segments, cue.start));
    const end = Math.min(durationSec, mapSourceTimeToTrimmed(segments, cue.end));
    if (start >= durationSec) return [];
    return [{ ...cue, start, end: Math.max(start + 0.2, end) }];
  });
}
