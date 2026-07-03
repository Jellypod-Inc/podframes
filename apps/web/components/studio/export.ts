import type { TurnRegion } from "./api";

/**
 * Caption/export helpers for the Studio. Builds SRT/VTT subtitle tracks from the
 * conversation's word-level timestamps (a cheap way to show off Speechbase word
 * alignment) and triggers client-side downloads of the rendered MP4 / audio.
 */

interface Cue {
  start: number;
  end: number;
  text: string;
}

/** Group each turn's words into short, readable caption cues. */
function captionCues(regions: TurnRegion[], maxWords = 8, maxDur = 3.2): Cue[] {
  const cues: Cue[] = [];
  for (const r of regions) {
    let buf: TurnRegion["words"] = [];
    const flush = () => {
      if (!buf.length) return;
      cues.push({
        start: buf[0].start,
        end: buf[buf.length - 1].end,
        text: buf.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim(),
      });
      buf = [];
    };
    for (const w of r.words) {
      buf.push(w);
      if (buf.length >= maxWords || w.end - buf[0].start >= maxDur) flush();
    }
    flush();
    // Turn with no word-level timing → one cue spanning the whole region.
    if (r.words.length === 0 && r.text?.trim()) {
      cues.push({ start: r.start, end: r.end, text: r.text.trim() });
    }
  }
  return cues.filter((c) => c.text);
}

/** Format seconds as HH:MM:SS,mmm (SRT) or HH:MM:SS.mmm (VTT). Total-ms first so
 *  a fraction that rounds up carries into the seconds (2.9996 → 00:00:03,000 —
 *  never the invalid ",1000"). */
function stamp(sec: number, msSep: "," | "."): string {
  const totalMs = Math.round(Math.max(0, sec) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const ss = Math.floor((totalMs % 60_000) / 1000);
  const mmm = totalMs % 1000;
  return `${p(h)}:${p(m)}:${p(ss)}${msSep}${p(mmm, 3)}`;
}

export function toSrt(regions: TurnRegion[]): string {
  return captionCues(regions)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

export function toVtt(regions: TurnRegion[]): string {
  const body = captionCues(regions)
    .map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

function trigger(filename: string, href: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download a same-origin URL (the rendered MP4 or conversation audio). */
export function downloadHref(filename: string, href: string): void {
  trigger(filename, href.split("?")[0]);
}

/** Download generated text (SRT/VTT) as a file. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  trigger(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
