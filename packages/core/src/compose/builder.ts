import { providerOf } from "../types";
import { BRAND, providerColor } from "../shared";
import { planBaseTrack } from "../stages/turn-timing";
import { fontFaceCss, type EmbeddedFont } from "./fonts";
import type { CaptionStyle, Cue, Host, TurnRegion } from "../types";
import type { CaptionGroup } from "./captions";

/** Readable text color (dark or light) to sit ON the chosen caption color. */
export function contrastText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return BRAND.text;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? BRAND.accentFg : BRAND.text;
}

/** Per-style GSAP vars applied to a word at its spoken start time, in the chosen color. */
function captionActiveVars(style: CaptionStyle, color: string): string {
  const fg = contrastText(color);
  switch (style) {
    case "karaoke":
      return `{ opacity: 1, color: '${color}', duration: 0.1 }`;
    case "highlight":
      return `{ opacity: 1, color: '${fg}', backgroundColor: '${color}', duration: 0.1 }`;
    case "neon":
      return `{ opacity: 1, color: '#EAFBFF', textShadow: '0 0 16px ${color}, 0 0 34px ${color}', duration: 0.12 }`;
    case "slam":
      return `{ opacity: 1, color: '${color}', scale: 1.08, duration: 0.12, ease: 'back.out(2.2)' }`;
    case "bold":
      return `{ opacity: 1, color: '${color}', duration: 0.1 }`;
    case "boxed":
      return `{ opacity: 1, color: '${fg}', duration: 0.1 }`;
    case "gradient":
      return "{ opacity: 1, duration: 0.12 }";
    case "clean":
    default:
      return `{ opacity: 1, color: '${BRAND.text}', duration: 0.12 }`;
  }
}

export interface ClipView {
  id: string;
  role: "avatar";
  hostId?: string;
  turnIndex?: number;
  segIndex?: number;
  src: string; // composition-relative
  durationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
}

export interface BuildInput {
  width: number;
  height: number;
  fps: number;
  title: string;
  hook: string;
  topic: string;
  durationSec: number;
  audioSrc: string; // composition-relative
  /** Embedded brand fonts (composition-relative woff2 files, see compose/fonts.ts). */
  fonts: EmbeddedFont[];
  hosts: Host[];
  clips: ClipView[];
  turns: TurnRegion[];
  captions: CaptionGroup[];
  /** Cues whose imagePath has been rewritten to a composition-relative `image`. */
  cues: Array<Cue & { image?: string }>;
  /** Caption visual style. */
  captionStyle: CaptionStyle;
  /** Primary caption color (hex). */
  captionColor: string;
  /** Per-host base avatar image (composition-relative) used as the decode-race poster. */
  hostAvatars?: Record<string, string>;
}

interface Tile {
  src: string;
  start: number;
  duration: number;
  kind?: "video" | "img";
  layer?: "fallback" | "clip";
  /** Mirror this tile horizontally (host face flip). */
  flip?: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Wrap inner HTML in a timed `.clip` overlay with correct data-* timing. */
function overlay(
  id: string,
  cls: string,
  start: number,
  duration: number,
  track: number,
  inner: string,
  initialOpacity = 0,
): string {
  return `    <div id="${id}" class="clip overlay ${cls}" data-start="${r2(start)}" data-duration="${r2(
    Math.max(0.1, duration),
  )}" data-track-index="${track}" style="opacity:${initialOpacity}">
${inner}
    </div>`;
}

/**
 * GSAP fade-in/out within an overlay's window. The framework gates the clip's
 * visibility to its [data-start, data-start+duration] window, so we only animate
 * opacity/transform — never visibility/display on a `.clip` element.
 */
function fade(
  out: string[],
  sel: string,
  start: number,
  duration: number,
  fIn: number,
  fOut: number,
  finalScene = false,
): void {
  const end = r2(start + duration);
  out.push(
    `    tl.fromTo('${sel}', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: ${fIn}, ease: 'expo.out' }, ${r2(start)});`,
  );
  if (!finalScene) {
    out.push(`    tl.to('${sel}', { opacity: 0, duration: ${fOut}, ease: 'power2.in' }, ${r2(end - fOut)});`);
    // Hard kill (opacity, not visibility) so seek-based frame extraction can't leave a stale frame.
    out.push(`    tl.set('${sel}', { opacity: 0 }, ${end});`);
  }
}

export function buildComposition(input: BuildInput): string {
  const { width, height, durationSec } = input;
  const hostById = new Map(input.hosts.map((h) => [h.id, h]));
  // Hosts whose face is mirrored horizontally — applied as a static transform on their tiles.
  const flipped = new Set(input.hosts.filter((h) => h.flip).map((h) => h.id));

  // Segment-precise lookup for the per-turn track (a long turn has several clips).
  const clipForSeg = (turnIndex: number, segIndex: number): ClipView | undefined =>
    input.clips.find((c) => c.turnIndex === turnIndex && (c.segIndex ?? 0) === segIndex);

  // ── Base video track (index 0): standalone per-turn clips, placed 1:1 ──
  // Each turn's clip IS its own audio file (the inter-turn pause is baked in), so we
  // tile by each turn's duration with a single cumulative cursor → exactly contiguous
  // (next.start === prev.start + prev.duration, no seams — the next clip's data-start
  // IS the same float the renderer computes for the previous clip's end), and the
  // final tile extends to durationSec to absorb rounding (full coverage, no black
  // tail). The clip is as long as its audio, so no held/frozen frames. A persistent
  // poster sits BEHIND the track (lowest z) purely as a frame-0 decode-race guard.
  const tiles: Tile[] = [];
  const avatars = input.hostAvatars ?? {};
  // One base-track tile per SEGMENT — a long turn split into several clips tiles
  // back-to-back, so it stays fully animated instead of capping at LTX's ~20s.
  const segs = input.turns
    .flatMap((t) => t.segments.map((s, segIndex) => ({ hostId: t.hostId, turnIndex: t.turnIndex, segIndex, durationSec: s.durationSec })))
    .filter((s) => clipForSeg(s.turnIndex, s.segIndex));
  const posterSrc = segs[0] ? avatars[segs[0].hostId] : undefined;
  const posterFlip = !!segs[0] && flipped.has(segs[0].hostId);
  const plan = planBaseTrack(segs.map((s) => s.durationSec), durationSec);
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const clip = clipForSeg(seg.turnIndex, seg.segIndex)!;
    const window = plan[i]!;
    const avatarSrc = avatars[seg.hostId];
    if (avatarSrc) {
      tiles.push({
        src: avatarSrc,
        start: window.start,
        duration: window.duration,
        kind: "img",
        layer: "fallback",
        flip: flipped.has(seg.hostId),
      });
    }
    // Clamp the on-screen tile to the clip's REAL length only when it materially
    // undershoots its window: the poster behind (lowest z) then fills the remainder
    // instead of the clip freezing its last frame over live audio. Window STARTS stay
    // audio-aligned (planBaseTrack). A sub-100ms residual (fps quantization in the
    // baked pause) is left as-is to avoid an inter-segment flicker.
    const duration = clip.durationSec < window.duration - 0.1 ? r2(clip.durationSec) : r2(window.duration);
    // Clips are ALREADY mirrored at animation time (video.ts hflip) → don't double-flip here.
    if (duration > 0.05) {
      tiles.push({ src: clip.src, start: window.start, duration, kind: "video", layer: "clip" });
    }
  }
  const segEls = tiles
    .map((t, i) => {
      const timing = `data-start="${t.start}" data-duration="${t.duration}" data-track-index="0"`;
      // Static mirror — independent of the renderer's time-gating + the GSAP overlay timelines.
      const flip = t.flip ? ` style="transform:scaleX(-1)"` : "";
      const cls = `seg ${t.layer === "fallback" ? "seg-fallback" : "seg-video"}`;
      return t.kind === "img"
        ? `    <img id="seg-${i}" class="${cls}" src="${t.src}" crossorigin="anonymous" alt="" ${timing}${flip} />`
        : `    <video id="seg-${i}" class="${cls}" src="${t.src}" muted playsinline crossorigin="anonymous" ${timing}${flip}></video>`;
    })
    .join("\n");
  // Poster = a static CSS-background div behind the whole video track (lowest z-index,
  // no timing attrs so it's always present and lint-clean). It only shows through before
  // the first frame decodes or at a seam, guaranteeing a non-black first frame.
  const posterEl = posterSrc
    ? `    <div id="poster" class="poster" style="background-image:url('${posterSrc}')${posterFlip ? ";transform:scaleX(-1)" : ""}"></div>\n`
    : "";
  const videoEls = posterEl + segEls;

  // ── Overlays ──
  const overlays: string[] = [];
  const tl: string[] = [];

  // Cues
  for (const cue of input.cues) {
    const host = cue.hostId ? hostById.get(cue.hostId) : undefined;
    const color = host ? providerColor(providerOf(host)) : "#22D3EE";
    const start = r2(cue.start);
    const dur = r2(cue.end - cue.start);
    const end = r2(start + dur);
    overlays.push(overlay(cue.id, `cue ${cue.type}`, start, dur, 12, cueInner(cue, color)));
    if (cue.type === "broll" && cue.image) {
      // B-roll is a centered CARD now (not full-screen) — the host stays visible under it,
      // so a speaker-switch never gets erased. It earns its own springy entrance instead of
      // the flat cue fade: the outer wrapper just snaps opaque/hard-kills at the edges (the
      // same seek-safety `fade()` gives every other cue), and the CARD does 100% of the
      // visible scale+opacity pop so the two curves never compound into a muddy fade.
      tl.push(
        `    tl.set('#${cue.id}', { opacity: 1 }, ${start});`,
        `    tl.fromTo('#${cue.id} .broll-card', { opacity: 0, scale: 0.82, y: 18 }, { opacity: 1, scale: 1, y: 0, duration: 0.55, ease: 'back.out(1.6)' }, ${start});`,
        `    tl.to('#${cue.id} .broll-card', { opacity: 0, scale: 0.9, duration: 0.35, ease: 'power2.in' }, ${r2(end - 0.35)});`,
        `    tl.set('#${cue.id}', { opacity: 0 }, ${end});`,
        // Slow Ken Burns so a photo never reads as a frozen frame.
        `    tl.fromTo('#${cue.id} .broll-img', { scale: 1.02 }, { scale: 1.12, duration: ${dur}, ease: 'none' }, ${start});`,
      );
      if (cue.title) {
        // The label lands just after the card settles — reveals during the pop compete
        // with it and lose (see .agents/skills/hyperframes-animation/rules/scale-swap-transition.md).
        tl.push(
          `    tl.fromTo('#${cue.id} .broll-label', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power3.out' }, ${r2(start + 0.35)});`,
        );
      }
    } else {
      fade(tl, `#${cue.id}`, start, dur, 0.4, 0.4);
    }
  }

  // Captions (one group at a time, per-word activation in the chosen style)
  const activeVars = captionActiveVars(input.captionStyle, input.captionColor);
  for (const group of input.captions) {
    const start = r2(group.start);
    const dur = r2(Math.max(0.5, group.end - group.start));
    overlays.push(overlay(group.id, `caption style-${input.captionStyle}`, start, dur, 16, captionInner(group)));
    fade(tl, `#${group.id}`, start, dur, 0.18, 0.14);
    group.words.forEach((w, wi) => {
      tl.push(`    tl.to('#${group.id} .w${wi}', ${activeVars}, ${r2(w.start)});`);
    });
  }

  return page(input, videoEls, overlays.join("\n"), tl.join("\n"));
}

// ── Inner-HTML fragments ──────────────────────────────────────────────────────

function cueInner(cue: Cue & { image?: string }, color: string): string {
  if (cue.type === "broll" && cue.image) {
    // A centered card laid OVER the avatar video, which keeps playing underneath —
    // same tier as the stat/quote/lower-third cards below, not a full-screen takeover.
    return `      <div class="broll-card">
        <img class="broll-img" src="${cue.image}" crossorigin="anonymous" alt="" />
        <div class="broll-scrim"></div>
        ${cue.title ? `<div class="broll-label" style="--ch:${color}"><span class="tick"></span>${esc(cue.title)}</div>` : ""}
      </div>`;
  }
  if (cue.type === "stat") {
    return `      <div class="stat-card" style="--ch:${color}">
        <div class="stat-figure">${esc(cue.figure ?? cue.title ?? "")}</div>
        ${cue.title && cue.figure ? `<div class="stat-title">${esc(cue.title)}</div>` : ""}
        ${cue.subtitle ? `<div class="stat-sub">${esc(cue.subtitle)}</div>` : ""}
      </div>`;
  }
  if (cue.type === "quote") {
    return `      <div class="quote-card" style="--ch:${color}">
        <div class="quote-mark">"</div>
        <div class="quote-text">${esc(cue.title ?? "")}</div>
        ${cue.subtitle ? `<div class="quote-sub">— ${esc(cue.subtitle)}</div>` : ""}
      </div>`;
  }
  return `      <div class="l3-bar" style="--ch:${color}">
        <span class="l3-accent"></span>
        <div class="l3-text">
          <div class="l3-title">${esc(cue.title ?? "")}</div>
          ${cue.subtitle ? `<div class="l3-sub">${esc(cue.subtitle)}</div>` : ""}
        </div>
      </div>`;
}

function captionInner(group: CaptionGroup): string {
  const spans = group.words.map((w, i) => `<span class="w${i}">${esc(w.text)}</span>`).join(" ");
  return `      <div class="cap-inner">${spans}</div>`;
}

// ── Page shell ────────────────────────────────────────────────────────────────

function page(input: BuildInput, videoEls: string, overlays: string, timeline: string): string {
  const { width, height, durationSec, audioSrc, fps } = input;
  // design.md is the source of truth here too: warm charcoal (NEVER cool
  // blue-black), square-by-default surfaces (only status dots are round), DM
  // Sans + Geist Mono embedded so renders are identical on every machine.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${fontFaceCss(input.fonts)}
:root{
  --bg:${BRAND.bg}; --surface:${BRAND.surface}; --surface-2:${BRAND.surface2}; --hairline:${BRAND.hairline};
  --text:${BRAND.text}; --text-2:${BRAND.textSecondary}; --accent:${BRAND.accent}; --accent-blue:${BRAND.accentBlue}; --danger:${BRAND.danger};
  --cap:${input.captionColor}; --cap-fg:${contrastText(input.captionColor)};
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#000;overflow:hidden;
  font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:var(--bg)}
.poster{position:absolute;inset:0;background:${BRAND.bg} center/cover no-repeat;z-index:0}
.seg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.seg-fallback{z-index:1}
.seg-video{z-index:2}
.overlay{position:absolute;inset:0;pointer-events:none}
/* Visual stacking is CSS z-index (data-track-index does NOT layer). Bottom→top:
   video(0) < cards incl. b-roll(20) < captions(50). B-roll is a
   centered card (not full-screen), so it shares the same tier as stat/quote/l3. */
.cue{z-index:20}
.caption{z-index:50}

/* The scrim keeps every caption state readable over bright b-roll or light
   video — the studio preview shows the same gradient (they must agree). */
.caption{display:flex;align-items:flex-end;justify-content:center;padding-bottom:96px;
  background:linear-gradient(180deg,rgba(16,15,14,0) 55%,rgba(16,15,14,.72) 100%)}
.cap-inner{max-width:1500px;text-align:center;font-size:60px;font-weight:700;line-height:1.3;
  color:var(--text-2);text-shadow:0 4px 24px rgba(0,0,0,.7);padding:0 40px}
.cap-inner span{display:inline-block;opacity:.65;padding:0 .04em}
/* Caption styles differ in LAYOUT, not just color: each groups a different
   phrase length (CAPTION_STYLE_PRESETS.maxWords) and sizes to match — slam is
   two huge words per beat, boxed a full smaller subtitle line. The highlight/
   glow/pill color is var(--cap), set per project. */
.style-karaoke .cap-inner{font-weight:800;font-size:66px}
.style-highlight .cap-inner{font-size:56px}
.style-highlight .cap-inner span{padding:.04em .16em}
.style-neon .cap-inner{font-size:58px;color:color-mix(in srgb, var(--cap) 55%, white)}
/* slam/bold scale + 900 weight eat the inter-word space — give words real padding
   so the active word's pop never touches its neighbor */
.style-slam .cap-inner{font-weight:900;text-transform:uppercase;letter-spacing:.01em;font-size:112px;line-height:1.05}
.style-slam .cap-inner span{padding:0 .14em}
.style-bold .cap-inner{font-weight:900;text-transform:uppercase;letter-spacing:.005em;font-size:78px;line-height:1.12}
.style-bold .cap-inner span{padding:0 .1em}
.style-gradient .cap-inner{background:linear-gradient(90deg,var(--cap),var(--accent-blue));-webkit-background-clip:text;background-clip:text;color:transparent}
.style-gradient .cap-inner span{color:transparent}
/* boxed = HyperFrames-style subtitle block: a full line on a colored background */
.style-boxed .cap-inner{font-size:46px;font-weight:600;background:var(--cap);color:var(--cap-fg);padding:.16em .5em;text-shadow:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.style-boxed .cap-inner span{opacity:.78}

/* B-roll is a COMPACT corner card pinned top-right, OVER the avatar video — small
   enough that the host's face (center frame) is never covered. Not a takeover. */
.broll{display:flex;justify-content:flex-end;align-items:flex-start;padding:48px}
.broll-card{position:relative;width:min(400px,34%);aspect-ratio:1/1;overflow:hidden;
  border:1px solid var(--hairline);box-shadow:0 24px 70px rgba(0,0,0,.55);transform-origin:80% 20%}
.broll-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center}
.broll-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(16,15,14,0) 55%,rgba(16,15,14,.78) 100%)}
.broll-label{position:absolute;left:16px;right:16px;bottom:13px;display:flex;align-items:center;gap:10px;
  font-size:21px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.broll-label .tick{width:8px;height:8px;background:var(--ch);flex-shrink:0}

/* Stat cards get the same compact corner treatment as b-roll — pinned top-right
   over the video so the host's face stays visible. */
.stat{display:flex;justify-content:flex-end;align-items:flex-start;padding:48px}
.stat-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 44px;
  background:rgba(24,23,21,.92);border:1px solid var(--hairline);border-right:4px solid var(--ch);
  box-shadow:0 24px 70px rgba(0,0,0,.5)}
.stat-figure{font-family:'Geist Mono',monospace;font-size:96px;font-weight:600;letter-spacing:-.03em;color:var(--ch);
  text-shadow:0 0 34px color-mix(in srgb, var(--ch) 40%, transparent);font-variant-numeric:tabular-nums}
.stat-title{font-size:27px;font-weight:700;color:var(--text)}
.stat-sub{font-size:21px;color:var(--text-2)}

.quote{display:grid;place-items:center;padding:0 14%}
.quote-card{position:relative;text-align:center}
.quote-mark{font-size:220px;line-height:.5;color:var(--ch);opacity:.5;font-weight:800}
.quote-text{font-size:72px;font-weight:700;color:var(--text);line-height:1.16;margin-top:24px}
.quote-sub{margin-top:28px;font-size:32px;color:var(--text-2)}

.lower-third{display:flex;align-items:flex-end;padding:0 0 200px 64px}
.l3-bar{display:flex;align-items:stretch;gap:20px;background:rgba(16,15,14,.84);border:1px solid var(--hairline);
  padding:22px 30px;max-width:1200px}
.l3-accent{width:6px;background:var(--ch);box-shadow:0 0 18px var(--ch)}
.l3-title{font-size:44px;font-weight:700;color:var(--text);line-height:1.1}
.l3-sub{font-size:30px;color:var(--text-2);margin-top:6px}
</style>
</head>
<body>
<div id="root" data-composition-id="podframes" data-start="0" data-width="${width}" data-height="${height}" data-duration="${r2(
    durationSec,
  )}" data-fps="${fps}">
${videoEls}
    <audio id="conversation" src="${audioSrc}" data-start="0" data-duration="${r2(durationSec)}" data-track-index="5" data-volume="1"></audio>
${overlays}
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
(function(){
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
${timeline}
  window.__timelines["podframes"] = tl;
})();
</script>
</div>
</body>
</html>
`;
}
