"use client";

import { useEffect, useRef, useState } from "react";
import { CAPTION_STYLES, CAPTION_COLORS } from "@/lib/site";
import { VISUAL_TREATMENTS } from "@podframes/core/shared";
import { useDraft } from "@/components/studio/useDraft";
import { useTransport } from "@/components/studio/transport";
import { getProject, regenCueImage, mediaUrl, type Cue } from "@/components/studio/api";
import { useWizard } from "./context";
import { StepHeader, StepFooter, inputClass } from "./ui";

const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// Only "broll" cues carry an image — "stat"/"quote"/"lower-third" are text cards laid
// directly over the host video (see compose/builder.ts cueInner). Label them so an entry
// with no thumbnail doesn't read as broken.
const TYPE_LABEL: Record<Cue["type"], string> = { broll: "B-ROLL", stat: "STAT", quote: "QUOTE", "lower-third": "LOWER-THIRD" };

export function Step3Look() {
  const ctx = useWizard();
  const { project, locked, busy, running } = ctx;
  const { duration, seek } = useTransport();
  const options = project?.options;
  const color = options?.captionColor ?? "#22D3EE";
  const treatment = options?.visualTreatment ?? "minimal";
  const disabled = locked || busy;

  // Key drafts to the values they mirror (not project.updatedAt) so an unrelated save
  // (a caption change, an image regen) can't wipe in-progress cue text edits.
  const [custom, setCustom] = useDraft(color, color);
  const [cues, setCues] = useDraft<Cue[]>(project?.cues ?? [], JSON.stringify(project?.cues ?? []));
  const [regenId, setRegenId] = useState<string | null>(null);

  const setOption = (patch: Record<string, unknown>) => ctx.patch({ options: patch as never });
  const saveCues = async (next: Cue[]) => {
    setCues(next);
    await ctx.patch({ cues: next });
  };

  // Dragging a slider thumb fires onChange continuously — update the local draft on every
  // tick (cheap, no network) and only PATCH once the drag actually ends. A ref (not the
  // closed-over `cues`) is what onPointerUp reads, so it always sees the latest drag tick
  // instead of whatever `cues` was when the listener was attached.
  const cuesRef = useRef(cues);
  useEffect(() => {
    cuesRef.current = cues;
  });
  const commitCues = () => void saveCues(cuesRef.current);

  async function suggest() {
    // Re-suggesting replaces the whole cue list — including any hand-tuned
    // timings, titles, and prompts below. Ask before discarding edits.
    if (cues.length > 0 && !(await ctx.confirm({
      title: "Replace b-roll cues?",
      body: "A fresh suggestion replaces the current cue list, including hand-tuned timings, titles, and prompts.",
      details: [`Will replace ${cues.length} cue${cues.length === 1 ? "" : "s"}.`, "You can edit the new suggestions afterward."],
      confirmLabel: "Replace cues",
      tone: "warn",
    }))) return;
    // A re-suggest needs force — the broll stage is resumable and would otherwise return cached cues.
    const hadRender = project?.stages.render === "done" || project?.stages.compose === "done";
    await ctx.generate({ only: ["broll"], force: true });
    // only:['broll'] doesn't invalidate compose/render, so push the fresh cues through a PATCH
    // (INVALIDATION.broll) when a render already exists — otherwise they'd never reach the video.
    if (hadRender && ctx.slug) {
      const fresh = await getProject(ctx.slug);
      await ctx.patch({ cues: fresh.cues ?? [] });
    }
  }

  async function regen(cue: Cue) {
    if (!ctx.slug || !cue.imagePrompt) return;
    setRegenId(cue.id);
    try {
      await ctx.patch({ cues }); // persist any unsaved title/prompt edits before the round-trip re-seeds the draft
      await regenCueImage(ctx.slug, cue.id, cue.imagePrompt);
      await ctx.refresh();
    } catch {
      /* a failed regen leaves the prior image */
    } finally {
      setRegenId(null);
    }
  }

  return (
    <div>
      <StepHeader title="Dress it up" hint="Captions ride the word-level timing automatically — pick a look. B-roll is optional." />

      {/* Visual treatment — the original composition remains the default. Richer
          modes reuse every paid host clip and only invalidate compose/render. */}
      <div className="mono mb-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">VISUAL TREATMENT</div>
      <div className="mb-1.5 grid gap-1.5 lg:grid-cols-3">
        {VISUAL_TREATMENTS.map((preset) => {
          const on = treatment === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => !on && setOption({ visualTreatment: preset.id })}
              disabled={disabled}
              className="group border p-2.5 text-left disabled:opacity-50"
              style={{ borderColor: on ? "var(--color-accent)" : "var(--color-hairline)", background: on ? "color-mix(in srgb, var(--color-accent) 6%, transparent)" : undefined }}
            >
              <TreatmentPreview id={preset.id} active={on} />
              <div className="mt-2 flex items-center justify-between gap-2 text-[13px] font-medium">
                <span>{preset.label}</span>
                {on && <span className="mono text-[9px] text-[var(--color-accent)]">ROUTED</span>}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-[var(--color-text-muted)]">{preset.description}</div>
              <div className="mono mt-2 text-[9px] text-[var(--color-text-secondary)]">{preset.densityLabel}</div>
            </button>
          );
        })}
      </div>
      {/* Switching restyles the EXISTING beats for free; the density each card
          promises only lands when the beats are (re)planned — say so, or the
          labels overpromise on an already-suggested episode. */}
      <div className="mb-6 text-[10px] leading-snug text-[var(--color-text-muted)]">
        Switching restyles your current beats without re-buying anything — hit “Suggest beats” below to plan at the new density.
      </div>

      {/* Captions */}
      <div className="mono mb-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">CAPTION COLOR</div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {CAPTION_COLORS.map((c) => {
          const on = color.toLowerCase() === c.toLowerCase();
          return (
            <button key={c} onClick={() => setOption({ captionColor: c })} disabled={disabled} title={c} aria-label={`Caption color ${c}`} className="h-6 w-6 border-2 disabled:opacity-40" style={{ background: c, borderColor: on ? "var(--color-text)" : "transparent" }} />
          );
        })}
        <label className="relative grid h-6 w-6 cursor-pointer place-items-center overflow-hidden border border-[var(--color-hairline)] text-[11px] text-[var(--color-text-muted)]" title="Custom color">
          +
          <input type="color" value={custom} disabled={disabled} onChange={(e) => setCustom(e.target.value)} onBlur={() => custom.toLowerCase() !== color.toLowerCase() && setOption({ captionColor: custom })} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      </div>

      <div className="mono mb-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">CAPTION STYLE</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {CAPTION_STYLES.map((c) => {
          const on = options?.captionStyle === c.id;
          return (
            <button key={c.id} onClick={() => setOption({ captionStyle: c.id })} disabled={disabled} className="border p-2.5 text-left disabled:opacity-50" style={{ borderColor: on ? "var(--color-accent)" : "var(--color-hairline)" }}>
              <div className="flex items-center justify-between text-sm font-medium">{c.label}{on && <span className="text-[11px] text-[var(--color-accent)]">selected</span>}</div>
              <div className="text-[11px] leading-snug text-[var(--color-text-muted)]">{c.description}</div>
            </button>
          );
        })}
      </div>

      {/* B-roll */}
      <div className="mono mb-2 mt-6 flex items-center justify-between text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">
        <span>B-ROLL{cues.length ? ` · ${cues.length}` : ""}</span>
        {cues.length > 0 && <button onClick={() => saveCues([])} disabled={disabled} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-40">clear all</button>}
      </div>

      <button onClick={suggest} disabled={disabled} className="btn btn-ghost w-full py-2 text-sm disabled:opacity-50">
        {running ? "Thinking…" : cues.length ? `↻ Re-suggest ${treatment} beats` : `Suggest ${treatment} beats`}
      </button>

      <div className="mt-3 space-y-2">
        {cues.map((cue, i) => {
          const patchField = (field: keyof Cue) => (e: { target: { value: string } }) =>
            setCues((c) => c.map((x, j) => (j === i ? { ...x, [field]: e.target.value } : x)));
          const span = Math.max(duration, cue.end + 1, 5);
          return (
            <div key={cue.id} className="flex gap-2.5 border border-[var(--color-hairline)] p-2.5">
              <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden bg-[var(--color-surface-2)]">
                {cue.type === "broll" && cue.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(ctx.slug!, cue.imagePath, project?.updatedAt)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="mono text-center text-[8px] leading-tight text-[var(--color-text-muted)]">{TYPE_LABEL[cue.type]}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="mono border border-[var(--color-hairline)] px-1 text-[9px] tracking-[0.04em] text-[var(--color-text-muted)]">{TYPE_LABEL[cue.type]}</span>
                  <button onClick={() => saveCues(cues.filter((_, j) => j !== i))} disabled={disabled} className="ml-auto text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-40" title="Remove" aria-label={`Remove ${cue.type} cue`}>✕</button>
                </div>

                {/* Dual-thumb range: drag either end to retime the cue. Both inputs share one
                    track; .cue-range makes the track click-through so only the thumb you're
                    touching responds (see globals.css). */}
                <div className="relative h-4 py-0.5">
                  <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 bg-[var(--color-hairline)]" />
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 bg-[var(--color-accent)]"
                    style={{ left: `${(cue.start / span) * 100}%`, width: `${((cue.end - cue.start) / span) * 100}%` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={span}
                    step={0.1}
                    value={cue.start}
                    disabled={disabled}
                    onChange={(e) => setCues((c) => c.map((x, j) => (j === i ? { ...x, start: Math.min(Number(e.target.value), x.end - 0.2) } : x)))}
                    onPointerUp={commitCues}
                    onMouseUp={commitCues}
                    onTouchEnd={commitCues}
                    className="cue-range absolute inset-0 h-4 w-full"
                    aria-label={`${TYPE_LABEL[cue.type]} cue start`}
                  />
                  <input
                    type="range"
                    min={0}
                    max={span}
                    step={0.1}
                    value={cue.end}
                    disabled={disabled}
                    onChange={(e) => setCues((c) => c.map((x, j) => (j === i ? { ...x, end: Math.max(Number(e.target.value), x.start + 0.2) } : x)))}
                    onPointerUp={commitCues}
                    onMouseUp={commitCues}
                    onTouchEnd={commitCues}
                    className="cue-range absolute inset-0 h-4 w-full"
                    aria-label={`${TYPE_LABEL[cue.type]} cue end`}
                  />
                </div>
                <div className="mono flex items-center justify-between text-[9px] text-[var(--color-text-muted)]">
                  <button onClick={() => seek(cue.start)} disabled={disabled} className="hover:text-[var(--color-accent)] disabled:opacity-40" title="Jump preview to this cue">▶ {tc(cue.start)}</button>
                  <span>{tc(cue.end)}</span>
                </div>

                {cue.type === "stat" && (
                  <input value={cue.figure ?? ""} disabled={disabled} onChange={patchField("figure")} onBlur={() => saveCues(cues)} placeholder="figure, e.g. 42%" className={inputClass} />
                )}
                <input value={cue.title ?? ""} disabled={disabled} onChange={patchField("title")} onBlur={() => saveCues(cues)} placeholder={cue.type === "quote" ? "quote text" : "label"} className={inputClass} />
                {cue.type !== "broll" && (
                  <input value={cue.subtitle ?? ""} disabled={disabled} onChange={patchField("subtitle")} onBlur={() => saveCues(cues)} placeholder="subtitle (optional)" className={inputClass} />
                )}
                {cue.type === "broll" && (
                  <div className="flex gap-2">
                    <textarea value={cue.imagePrompt ?? ""} disabled={disabled} onChange={(e) => setCues((c) => c.map((x, j) => (j === i ? { ...x, imagePrompt: e.target.value } : x)))} rows={2} placeholder="image prompt" className={`${inputClass} resize-none`} />
                    <button onClick={() => regen(cue)} disabled={disabled || !cue.imagePrompt || regenId === cue.id} className="btn btn-ghost shrink-0 px-3 text-xs disabled:opacity-50" title="Regenerate image" aria-label="Regenerate image">{regenId === cue.id ? "…" : "↻"}</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <StepFooter>
        <button onClick={() => ctx.go(5)} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">Next: Output →</button>
      </StepFooter>
    </div>
  );
}

function TreatmentPreview({ id, active }: { id: (typeof VISUAL_TREATMENTS)[number]["id"]; active: boolean }) {
  const signal = active ? "var(--color-accent)" : "var(--color-text-muted)";
  return (
    <div className="relative h-12 overflow-hidden border border-[var(--color-hairline)] bg-[var(--color-bg)]" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 w-[58%] bg-[var(--color-surface-2)]" />
      <div className="absolute left-2 top-2 h-1.5 w-8" style={{ background: signal, opacity: 0.8 }} />
      <div className="absolute left-2 top-5 h-1 w-12 bg-[var(--color-text-muted)] opacity-40" />
      {id === "minimal" && <div className="absolute right-2 top-2 h-5 w-5 border border-[var(--color-hairline)] bg-[var(--color-surface)]" />}
      {id === "editorial" && (
        <>
          <div className="absolute bottom-2 right-2 top-2 w-[34%] border border-[var(--color-hairline)] bg-[var(--color-surface)]" />
          <div className="absolute bottom-2 left-2 h-1 w-[72%] origin-left" style={{ background: signal }} />
        </>
      )}
      {id === "cinematic" && (
        <>
          <div className="absolute inset-0 bg-[var(--color-surface-2)] opacity-80" />
          <div className="absolute inset-x-2 top-2 h-5 border border-[var(--color-hairline)]" />
          <div className="absolute bottom-2 left-2 h-1.5 w-[58%]" style={{ background: signal }} />
          <div className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full" style={{ background: signal }} />
        </>
      )}
    </div>
  );
}
