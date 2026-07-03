import type { TurnRegion, WordTs } from "../types";

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionGroup {
  id: string;
  hostId: string;
  start: number;
  end: number;
  words: CaptionWord[];
  text: string;
}

const SENTENCE_END = /[.!?]$/;
const PAUSE_GAP = 0.45;

/**
 * Group aligned words into readable caption phrases. Breaks on turn boundaries,
 * sentence-ending punctuation, long pauses, or `maxWords` — the per-style line
 * length (slam = 2 huge words per beat, boxed = a full subtitle line; see
 * CAPTION_STYLE_PRESETS). One group is on screen at a time — exactly what the
 * HyperFrames caption contract wants.
 */
export function buildCaptionGroups(turns: TurnRegion[], maxWords = 6): CaptionGroup[] {
  const groups: CaptionGroup[] = [];

  for (const turn of turns) {
    let bucket: WordTs[] = [];
    const flush = () => {
      if (bucket.length === 0) return;
      const words = bucket.map((w) => ({ text: w.text, start: w.start, end: w.end }));
      groups.push({
        id: `cg-${groups.length}`,
        hostId: turn.hostId,
        start: words[0]!.start,
        end: words[words.length - 1]!.end,
        words,
        text: words.map((w) => w.text).join(" "),
      });
      bucket = [];
    };

    for (let i = 0; i < turn.words.length; i++) {
      const w = turn.words[i]!;
      const prev = turn.words[i - 1];
      const gap = prev ? w.start - prev.end : 0;
      if (bucket.length > 0 && (bucket.length >= maxWords || gap >= PAUSE_GAP)) flush();
      bucket.push(w);
      if (SENTENCE_END.test(w.text)) flush();
    }
    flush();
  }

  return groups;
}
