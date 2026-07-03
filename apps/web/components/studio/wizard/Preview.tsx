"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { captionMaxWords } from "@podframes/core/shared";
import {
  buildTrimmedTimeline,
  mapCuesToTrimmedTimeline,
  mapSourceTimeToTrimmed,
  mapTrimmedTimeToSource,
  type TrimmedSegment,
} from "@podframes/core/timeline";
import { mediaUrl, type ClipAsset, type TurnRegion, type Cue } from "@/components/studio/api";
import { providerColor, providerOfModel } from "@/lib/providers";
import { useTransport } from "@/components/studio/transport";
import { rosterThumb } from "@/lib/roster";
import { useWizard } from "./context";
import { hostFace } from "./cast";
import type { CaptionStyle, WordTs } from "@podframes/core";

const EMPTY_REGIONS: TurnRegion[] = [];
const EMPTY_CLIPS: ClipAsset[] = [];

const tc = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

export function Preview() {
  const { project, slug, cast, log, running, clipTrimDrafts } = useWizard();
  const { time, duration, playing, seek, togglePlay } = useTransport();
  const [showFinal, setShowFinal] = useState(false);

  const vertical = (project?.config.aspectRatio ?? "9:16") === "9:16";
  const sourceRegions = project?.speech?.turns ?? EMPTY_REGIONS;
  const hasFinal = project?.stages.render === "done" && !!project?.videoUrl;
  const hasAudio = duration > 0;
  const sourceClips = project?.clips ?? EMPTY_CLIPS;
  const previewClips = useMemo(
    () => sourceClips.map((clip) => ({ ...clip, ...(clipTrimDrafts[clip.id] ?? {}) })),
    [sourceClips, clipTrimDrafts],
  );
  const trimTimeline = useMemo(
    () => buildTrimmedTimeline(sourceRegions, previewClips),
    [sourceRegions, previewClips],
  );
  const displayTime = trimTimeline.hasTrim ? mapSourceTimeToTrimmed(trimTimeline.segments, time) : time;
  const displayDuration = trimTimeline.hasTrim ? trimTimeline.durationSec : duration;
  const regions = trimTimeline.hasTrim ? trimTimeline.turns : sourceRegions;
  const region = activeRegion(regions, displayTime);

  useEffect(() => {
    if (!playing || !trimTimeline.hasTrim) return;
    const target = sourceSkipTarget(trimTimeline.segments, time);
    if (target != null && target > time + 0.01) seek(target);
  }, [playing, seek, time, trimTimeline]);

  // Once a turn HAS a generated clip, the preview plays that clip for its region —
  // the still image is only the fallback for turns not yet animated, so the right
  // pane always reflects the newest generated state at a glance.
  const clipByTurn = useMemo(
    () => new Map(previewClips.map((c) => [c.turnIndex, c])),
    [previewClips],
  );
  const savedRegionClip = region ? clipByTurn.get(region.turnIndex) : undefined;
  const regionClip = savedRegionClip;
  const hasTrimDrafts = Object.keys(clipTrimDrafts).length > 0;
  const showRenderedFinal = showFinal && hasFinal && !hasTrimDrafts;

  // Whichever cue covers the current timestamp — edits and regens show up here the instant
  // you scrub/play to that point. Only "broll" cues carry an image (a full-frame photo that
  // covers the host, per compose/builder.ts); "stat"/"quote"/"lower-third" are text cards
  // laid OVER the still-visible host, so those render as an overlay, not a replacement.
  const cues: Cue[] = project?.cues ?? [];
  const timedCues = trimTimeline.hasTrim ? mapCuesToTrimmedTimeline(cues, trimTimeline.segments, displayDuration) : cues;
  const activeCue = timedCues.find((c) => displayTime >= c.start && displayTime < c.end);
  const cueColor = (c: Cue): string => {
    const host = c.hostId ? project?.config.hosts.find((h) => h.id === c.hostId) : undefined;
    return host ? providerColor(providerOfModel(host.model)) : "#22D3EE";
  };

  // Live proof-of-progress during the video stage: read straight off the run
  // stream's TYPED clip events (per-turn providers only) so the pane shows the
  // actual lip-synced clip that just landed instead of a scrolling text line.
  // Reverts to the static PREVIEW mode when the stage succeeds OR ERRORS (a
  // failed run must never leave the pane stuck in LIVE mode with no scrubber),
  // and is gated on `running` so a dead stream always falls back too.
  const live = useMemo(() => {
    let latest: { path: string; turnIndex?: number } | null = null;
    let total = 0;
    let stageDone = false;
    const started = new Set<number>();
    const finished = new Set<number>();
    for (const l of log) {
      if (l.stage !== "video") continue;
      if (l.level === "success" || l.level === "error") stageDone = true;
      if (!l.clip) continue;
      total = l.clip.total;
      if (l.clip.status === "rendering") started.add(l.clip.turnIndex);
      if (l.clip.status === "done") {
        finished.add(l.clip.turnIndex);
        if (l.clip.path) latest = { path: l.clip.path, turnIndex: l.clip.turnIndex };
      }
    }
    return { latest: stageDone || !running ? null : latest, total, started, finished };
  }, [log, running]);

  // The face to show for the talking host: base avatar → roster portrait → none.
  // Versioned by the stills stage, not updatedAt — an unrelated autosave must not
  // refetch every face image.
  function faceFor(hostId?: string): string | undefined {
    if (!hostId || !slug) return undefined;
    const avatar = project?.stills?.hosts[hostId]?.imagePath;
    if (avatar) return mediaUrl(slug, avatar, project?.stillsVersion ?? undefined);
    const uploaded = project?.uploads?.[hostId];
    if (uploaded) return mediaUrl(slug, uploaded, project?.stillsVersion ?? undefined);
    const ch = cast.find((c) => c.id === hostId);
    return ch?.rosterKey ? rosterThumb(ch.rosterKey) : undefined;
  }
  // "CH A google · CH B elevenlabs → 1 track" — the one-line proof the mix happened.
  const mixBadge = (() => {
    if (!project?.speech) return null;
    const ps = project.config.hosts.map((h) => providerOfModel(h.model));
    return [...new Set(ps)].length > 1 ? `${ps.join(" + ")} → 1 track` : null;
  })();
  const flipFor = (hostId?: string) => !!cast.find((c) => c.id === hostId)?.flip;

  const captionStyle = (project?.options?.captionStyle ?? "clean") as CaptionStyle;
  const captionColor = project?.options?.captionColor ?? "#22D3EE";
  const regionFace = faceFor(region?.hostId);
  const regionFlipped = flipFor(region?.hostId);
  const regionHasTrim = !!regionClip && ((regionClip.trimStartSec ?? 0) > 0 || (regionClip.trimEndSec ?? 0) > 0);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--color-bg)] p-5">
      <div
        className="relative overflow-hidden border border-[var(--color-hairline)] bg-[var(--color-surface-2)]"
        style={{ aspectRatio: vertical ? "9 / 16" : "16 / 9", height: vertical ? "min(48vh, 440px)" : "auto", width: vertical ? "auto" : "min(100%, 460px)" }}
      >
        {showRenderedFinal ? (
          <video key={project!.videoUrl!} src={`${project!.videoUrl}?v=${encodeURIComponent(project!.updatedAt)}`} controls className="h-full w-full bg-black object-contain" />
        ) : live.latest ? (
          <>
            {/* Not double-flipped: fal/replicate clips are already baked in the flipped
                orientation at animation time, unlike the raw stills faceFor() shows below. */}
            <video key={live.latest.path} src={slug ? mediaUrl(slug, live.latest.path) : undefined} autoPlay muted loop playsInline className="h-full w-full bg-black object-cover" />
            <span className="mono absolute left-2 top-2 border border-[var(--color-hairline)] bg-[#100f0ecc] px-1.5 py-0.5 text-[9px] text-[var(--color-accent)]">
              LIVE · {live.finished.size}/{live.total || "?"} clips
            </span>
          </>
        ) : hasAudio ? (
          <>
            {region && regionClip && slug ? (
              <TrimmedRegionClip
                clip={regionClip}
                region={region}
                slug={slug}
                version={project?.clipsVersion ?? undefined}
                time={displayTime}
                playing={playing}
                fallbackSrc={regionFace}
                fallbackFlipped={regionFlipped}
              />
            ) : regionFace ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={regionFace} alt="" className="h-full w-full object-cover" style={{ transform: regionFlipped ? "scaleX(-1)" : undefined }} />
            ) : (
              <div className="h-full w-full bg-[var(--color-surface-2)]" />
            )}
            {/* B-roll is a centered overlay card now (matches compose/builder.ts), not a
                full-frame takeover — the host stays visible, so a fresh speaker-switch is
                never erased by it. */}
            {activeCue && <CueCard cue={activeCue} color={cueColor(activeCue)} slug={slug} updatedAt={project?.updatedAt} />}
            {region && <Karaoke region={region} time={displayTime} style={captionStyle} color={captionColor} />}
            <span className="mono absolute left-2 top-2 border border-[var(--color-hairline)] bg-[#100f0ecc] px-1.5 py-0.5 text-[9px] text-[var(--color-text-muted)]">
              {hasFinal ? (hasTrimDrafts ? "DRAFT · TRIM" : "DRAFT") : regionClip ? (regionHasTrim ? "PREVIEW · TRIM" : "PREVIEW · CLIP") : "PREVIEW · STILL"}
            </span>
          </>
        ) : (
          <CastPreview />
        )}
      </div>

      {live.latest ? (
        <div className="w-full" style={{ maxWidth: vertical ? "248px" : "460px" }}>
          <ClipRail regions={regions} started={live.started} finished={live.finished} />
          <div className="mono mt-1.5 text-center text-[10px] text-[var(--color-text-muted)]">animating each line as it lands…</div>
        </div>
      ) : (
        hasAudio && (
          <div className="w-full" style={{ maxWidth: vertical ? "248px" : "460px" }}>
            <div className="flex items-center gap-3">
              <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="flex h-8 w-8 shrink-0 items-center justify-center border border-[var(--color-hairline)] text-[13px] text-[var(--color-accent)] hover:border-[var(--color-accent)]">{playing ? "❚❚" : "▶"}</button>
              <Scrubber
                time={displayTime}
                duration={displayDuration}
                onSeek={(t) => seek(trimTimeline.hasTrim ? mapTrimmedTimeToSource(trimTimeline.segments, t) : t)}
                regions={regions}
              />
            </div>
            <div className="mono mt-1.5 flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
              <span>{tc(displayTime)}</span>
              {hasFinal && hasTrimDrafts ? (
                <span className="text-[9px] text-[var(--color-warn)]">trim draft</span>
              ) : hasFinal ? (
                <button onClick={() => setShowFinal((v) => !v)} className="text-[var(--color-accent)] hover:underline">{showFinal ? "show draft" : "play final"}</button>
              ) : (
                mixBadge && <span className="truncate px-1 text-[9px] text-[var(--color-text-muted)]" title="One mixed, leveled Speechbase track">{mixBadge}</span>
              )}
              <span>{tc(displayDuration)}</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function sourceSkipTarget(segments: TrimmedSegment[], sourceTime: number): number | null {
  for (const segment of segments) {
    if (sourceTime < segment.oldStart) return segment.oldStart;
    if (sourceTime <= segment.oldEnd) return null;
  }
  return null;
}

function TrimmedRegionClip({
  clip,
  region,
  slug,
  version,
  time,
  playing,
  fallbackSrc,
  fallbackFlipped,
}: {
  clip: ClipAsset;
  region: TurnRegion;
  slug: string;
  version?: string | number | null;
  time: number;
  playing: boolean;
  fallbackSrc?: string;
  fallbackFlipped?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trimStart = Math.max(0, clip.trimStartSec ?? 0);
  const trimEnd = Math.max(0, clip.trimEndSec ?? 0);
  const local = Math.max(0, time - region.start);
  const visualEnd = Math.max(0.1, Math.min(region.durationSec, clip.durationSec - trimStart - trimEnd));
  const showClip = local < visualEnd;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showClip) return;
    const target = trimStart + Math.max(0, Math.min(local, visualEnd - 0.02));
    if (Math.abs(video.currentTime - target) > 0.12) video.currentTime = target;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [clip.path, local, playing, showClip, trimStart, visualEnd]);

  return (
    <>
      {fallbackSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackSrc}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: fallbackFlipped ? "scaleX(-1)" : undefined }}
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--color-surface-2)]" />
      )}
      {showClip && (
        <video
          ref={videoRef}
          key={`${clip.path}:${trimStart}:${trimEnd}`}
          src={mediaUrl(slug, clip.path, version ?? undefined)}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full bg-black object-cover"
        />
      )}
    </>
  );
}

/** Step 1 — the two cast faces side by side, before any audio exists. */
function CastPreview() {
  const { project, slug, cast } = useWizard();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-5 text-center">
      <div className="flex items-end gap-3">
        {cast.map((ch) => {
          const color = providerColor(ch.provider);
          const face = hostFace(project, slug, ch);
          return (
            <div key={ch.id} className="flex flex-col items-center gap-1.5">
              <div className="h-16 w-16 overflow-hidden bg-[var(--color-surface)]" style={{ border: `1px solid ${color}` }}>
                {face ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={face} alt={ch.name} className="h-full w-full object-cover" style={{ transform: ch.flip ? "scaleX(-1)" : undefined }} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg" style={{ color, transform: ch.flip ? "scaleX(-1)" : undefined }}>{ch.name.slice(0, 1) || "?"}</div>
                )}
              </div>
              <span className="text-[11px] text-[var(--color-text-secondary)]">{ch.name}</span>
            </div>
          );
        })}
      </div>
      <span className="text-[11px] text-[var(--color-text-muted)]">Write the script to hear them talk.</span>
    </div>
  );
}

function activeRegion(regions: TurnRegion[], t: number): TurnRegion | undefined {
  if (regions.length === 0) return undefined;
  for (const r of regions) if (t >= r.start && t < r.end) return r;
  // Before the first word → first turn; after the last → hold the last (never snap back to the start).
  return t < regions[0].start ? regions[0] : regions[regions.length - 1];
}

// Mirrors compose/builder.ts contrastText — the preview must agree with the render.
function contrastText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#F4F2EC";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#04181D" : "#F4F2EC";
}

type WordState = "active" | "played" | "upcoming";

function wordStyle(style: CaptionStyle, state: WordState, color: string): React.CSSProperties {
  if (style === "boxed") return { color: contrastText(color), opacity: state === "active" ? 1 : 0.78 };
  if (state !== "active") return { color: state === "played" ? "#F4F2EC" : "#A8A298" };
  switch (style) {
    case "clean":
      return { color: "#FFFFFF" };
    case "highlight":
      return { color: contrastText(color), background: color, padding: "0 0.25rem" };
    case "neon":
      return { color: "#EAFBFF", textShadow: `0 0 16px ${color}, 0 0 34px ${color}` };
    case "slam":
      return { color, display: "inline-block", transform: "scale(1.08)" };
    case "bold":
      return { color, fontWeight: 900 };
    case "gradient":
      return { backgroundImage: `linear-gradient(90deg,${color},#5B8CFF)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" };
    case "karaoke":
    default:
      return { color };
  }
}

/** Passive per-turn progress — clips land out of order (a concurrency pool), so this is
 *  the "N of M actively in flight" signal that keeps a scattered completion order legible. */
function ClipRail({ regions, started, finished }: { regions: TurnRegion[]; started: Set<number>; finished: Set<number> }) {
  if (regions.length === 0) return null;
  return (
    <div className="flex h-2 w-full gap-[2px]">
      {regions.map((r) => (
        <span
          key={r.turnIndex}
          className="h-full flex-1"
          style={{ background: finished.has(r.turnIndex) ? "var(--color-accent)" : started.has(r.turnIndex) ? "var(--color-warn)" : "var(--color-hairline)" }}
        />
      ))}
    </div>
  );
}

/** stat/quote/lower-third cards, mirroring compose/builder.ts's cueInner() so the preview
 *  matches what the real render actually draws over the (still-visible) host. */
function CueCard({ cue, color, slug, updatedAt }: { cue: Cue; color: string; slug: string | null; updatedAt?: string }) {
  if (cue.type === "broll") {
    if (!cue.imagePath || !slug) return null;
    return (
      <div className="absolute inset-0 grid place-items-center px-[8%]">
        {/* cue-pop mirrors the render's GSAP entrance (scale+opacity, back.out overshoot);
            key remounts it (replaying the animation) each time you scrub into a new cue. */}
        <div key={cue.id} className="cue-pop relative aspect-square w-[60%] max-w-[220px] overflow-hidden border border-[var(--color-hairline)] shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(slug, cue.imagePath, updatedAt)} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/75" />
          {cue.title && (
            <div className="absolute inset-x-2.5 bottom-2 flex items-center gap-1.5 overflow-hidden text-[11px] font-bold text-white">
              <span className="h-2 w-2 shrink-0" style={{ background: color }} />
              <span className="truncate">{cue.title}</span>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (cue.type === "stat") {
    return (
      <div className="absolute inset-0 grid place-items-center px-6">
        <div className="flex flex-col items-center gap-1 border border-[var(--color-hairline)] bg-[#181715dd] px-6 py-5 text-center shadow-lg">
          <div className="text-3xl font-extrabold leading-none" style={{ color }}>{cue.figure || cue.title || ""}</div>
          {cue.title && cue.figure && <div className="text-[13px] font-bold text-white">{cue.title}</div>}
          {cue.subtitle && <div className="text-[11px] text-white/70">{cue.subtitle}</div>}
        </div>
      </div>
    );
  }
  if (cue.type === "quote") {
    return (
      <div className="absolute inset-0 grid place-items-center px-9 text-center">
        <div>
          <div className="text-4xl font-extrabold leading-none opacity-50" style={{ color }}>&ldquo;</div>
          <div className="-mt-2 text-[15px] font-bold leading-snug text-white">{cue.title}</div>
          {cue.subtitle && <div className="mt-2 text-[11px] text-white/70">— {cue.subtitle}</div>}
        </div>
      </div>
    );
  }
  // lower-third
  return (
    <div className="absolute inset-x-3 bottom-[12%] flex items-stretch gap-2.5 border border-[var(--color-hairline)] bg-[#100f0ed1] px-3 py-2">
      <span className="w-1 shrink-0" style={{ background: color }} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-bold text-white">{cue.title}</div>
        {cue.subtitle && <div className="truncate text-[10px] text-white/70">{cue.subtitle}</div>}
      </div>
    </div>
  );
}

/** Mirror compose/captions.ts grouping so the preview shows the same PHRASES the
 *  render will: break on sentence ends, pauses, and the style's maxWords. */
function groupWords(words: WordTs[], maxWords: number): WordTs[][] {
  const groups: WordTs[][] = [];
  let bucket: WordTs[] = [];
  const flush = () => {
    if (bucket.length) groups.push(bucket);
    bucket = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = words[i - 1];
    const gap = prev ? w.start - prev.end : 0;
    if (bucket.length > 0 && (bucket.length >= maxWords || gap >= 0.45)) flush();
    bucket.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  }
  flush();
  return groups;
}

/** Per-style caption typography for the preview pane (scaled-down mirror of the
 *  render's .style-* CSS — slam is two huge words, boxed a smaller full line). */
function capClass(style: CaptionStyle): string {
  switch (style) {
    case "slam":
      return "text-[26px] font-black uppercase leading-none";
    case "bold":
      return "text-[21px] font-black uppercase leading-tight";
    case "boxed":
      return "text-[14px] font-semibold leading-snug";
    case "karaoke":
      return "text-[18px] font-extrabold leading-snug";
    case "highlight":
    case "neon":
      return "text-[16px] font-bold leading-snug";
    default:
      return "text-[17px] font-bold leading-snug";
  }
}

function Karaoke({ region, time, style, color }: { region: TurnRegion; time: number; style: CaptionStyle; color: string }) {
  const boxed = style === "boxed";
  const groups = useMemo(() => groupWords(region.words, captionMaxWords(style)), [region.words, style]);
  // The group under the playhead (or the next one up, before its first word starts).
  const active =
    groups.find((g) => time >= g[0]!.start && time < g[g.length - 1]!.end + 0.15) ??
    groups.find((g) => g[0]!.start >= time) ??
    groups[groups.length - 1];
  if (!active) return null;
  // slam/bold pop + 900 weight eat the inter-word space — pad words so the
  // active word never touches its neighbor (mirrors the render's span padding).
  const wordGap =
    style === "slam" ? { padding: "0 0.14em" } : style === "bold" ? { padding: "0 0.1em" } : undefined;
  return (
    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-5 pb-6 pt-10 text-center">
      <p className={capClass(style)} style={boxed ? { display: "inline-block", background: color, padding: "0.15em 0.5em" } : undefined}>
        {active.map((w, i) => {
          const state: WordState = time >= w.start && time < w.end ? "active" : time >= w.end ? "played" : "upcoming";
          return (
            <span key={i} style={{ ...wordGap, ...wordStyle(style, state, color) }}>
              {w.text}{" "}
            </span>
          );
        })}
      </p>
    </div>
  );
}

/** The scrubber IS a patch-bay moment: each turn's segment is tinted with its
 *  host's provider color, so the multi-provider mix is visible on the timeline
 *  itself. Draggable (pointer capture) + keyboard-seekable, not click-only. */
function Scrubber({ time, duration, onSeek, regions }: { time: number; duration: number; onSeek: (t: number) => void; regions: TurnRegion[] }) {
  const { project } = useWizard();
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const colorFor = (hostId: string): string => {
    const host = project?.config.hosts.find((h) => h.id === hostId);
    return host ? providerColor(providerOfModel(host.model)) : "var(--color-hairline)";
  };
  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      className="relative h-3 flex-1 cursor-pointer outline-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFromPointer(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onSeek(Math.max(0, time - (e.shiftKey ? 5 : 2)));
        if (e.key === "ArrowRight") onSeek(Math.min(duration, time + (e.shiftKey ? 5 : 2)));
      }}
    >
      <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 bg-[var(--color-hairline)]" />
      {duration > 0 &&
        regions.map((r) => (
          <span
            key={r.turnIndex}
            className="absolute top-1/2 h-[3px] -translate-y-1/2 opacity-50"
            style={{
              left: `${(r.start / duration) * 100}%`,
              width: `${((r.end - r.start) / duration) * 100}%`,
              background: colorFor(r.hostId),
            }}
          />
        ))}
      <div className="absolute top-1/2 h-[5px] -translate-y-1/2 bg-[var(--color-text-muted)] opacity-40" style={{ width: `${pct}%` }} />
      <span className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 bg-[var(--color-accent)]" style={{ left: `${pct}%` }} />
    </div>
  );
}
