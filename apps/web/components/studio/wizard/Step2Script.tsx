"use client";

import { useEffect, useRef } from "react";
import { providerColor, providerOfModel } from "@/lib/providers";
import { useDraft } from "@/components/studio/useDraft";
import type { ScriptTurn } from "@/components/studio/api";
import { useWizard } from "./context";
import { StepHeader, StepFooter, inputClass } from "./ui";

const DEFAULT_STYLE = "snappy and punchy — a fun, fast back-and-forth";

export function Step2Script() {
  const ctx = useWizard();
  const { project, topic, setTopic, style, setStyle, aspect, locked, running, busy } = ctx;
  const script = project?.script ?? null;
  const turns = script?.turns ?? [];
  const hasSpeech = project?.stages.speech === "done";

  // Editable copy of the turns, re-seeded ONLY when the script is (re)generated — scriptVersion
  // bumps on a rewrite but not on an edit-save, so autosave never clobbers what you're typing.
  const [draft, setDraft] = useDraft<ScriptTurn[]>(turns, project?.scriptVersion ?? "none");
  // Compare trimmed (the server trims) so trailing whitespace doesn't loop the autosave.
  const edited = JSON.stringify(draft.map((t) => t.text.trim())) !== JSON.stringify(turns.map((t) => t.text));
  // Non-empty, actually-changed, and not mid-run (a background save during a generate would 409).
  const canSave = edited && !!script && !locked && draft.every((t) => t.text.trim());
  const disabled = locked || busy;

  // Debounced SILENT autosave: persist edits ~700ms after you stop typing. Silent = never flips the
  // global busy flag, so the textarea you're typing in is never disabled/blurred mid-edit.
  useEffect(() => {
    if (!canSave || !script) return;
    const id = setTimeout(() => { void ctx.patch({ script: { ...script, turns: draft } }, { silent: true }); }, 700);
    return () => clearTimeout(id);
  }, [draft, canSave, script, ctx]);

  // Flush any pending edit when leaving the step, so navigating away never drops it.
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    flush.current = () => { if (canSave && script) void ctx.patch({ script: { ...script, turns: draft } }, { silent: true }); };
  });
  useEffect(() => () => flush.current(), []);

  const configChanged =
    !!project &&
    (topic.trim() !== project.config.topic ||
      (style.trim() || DEFAULT_STYLE) !== (project.config.styleNote?.trim() || DEFAULT_STYLE) ||
      aspect !== project.config.aspectRatio);

  // First write: persist any Step-2 topic/style/aspect edits (the project may have
  // been lazily created back on Step 1 with the placeholder topic), then run.
  async function create() {
    if (configChanged) await ctx.patch({ config: { topic: topic.trim(), styleNote: style.trim() || undefined, aspectRatio: aspect } });
    await ctx.generate({ to: "speech" });
  }

  // Rewrite from the topic. ALWAYS invalidate the whole downstream chain the way an edit does
  // (PATCH applies the INVALIDATION map) so a fresh script + voices can never leave stale
  // video / b-roll / output marked done behind it.
  async function rewrite() {
    if (!project?.script) return create();
    if (configChanged) await ctx.patch({ config: { topic: topic.trim(), styleNote: style.trim() || undefined, aspectRatio: aspect } });
    await ctx.patch({ script: project.script }); // INVALIDATION.script clears speech, video, broll, compose, render
    await ctx.generate({ only: ["script", "speech"], force: true });
  }

  // Re-synthesize voices for the current script (e.g. after a Step-1 voice change cleared the audio).
  async function revoice() {
    await ctx.generate({ to: "speech" });
  }

  // Re-voice with the user's manual text edits (clears speech + downstream, then re-synthesizes).
  async function applyEdits() {
    if (!script) return;
    await ctx.patch({ script: { ...script, turns: draft } });
    await ctx.generate({ to: "speech" });
  }

  // Remove a whole turn. The per-turn diff is positional, so every line AFTER the
  // deleted one shifts and gets re-voiced — free on a fresh script, but paid audio
  // deserves a confirm. (A conversation needs at least two lines.)
  async function removeTurn(i: number) {
    if (draft.length <= 2) return;
    if (
      hasSpeech &&
      !(await ctx.confirm({
        title: "Delete this line?",
        body: "Removing a line changes the turn order and invalidates generated audio for the affected script range.",
        details: [
          "This line's audio and clip will be removed.",
          ...(draft.length - 1 - i > 0
            ? [`${draft.length - 1 - i} following line${draft.length - 1 - i === 1 ? "" : "s"} will re-voice on the next Re-voice edits run.`]
            : []),
        ],
        confirmLabel: "Delete line",
        tone: "danger",
      }))
    ) {
      return;
    }
    setDraft((d) => d.filter((_, j) => j !== i));
  }

  return (
    <div>
      <StepHeader title="The script" hint="A topic becomes a tight two-host dialogue. Tweak any line, then re-voice it." />

      <label className="mono mb-1.5 block text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">TOPIC</label>
      <textarea value={topic} disabled={disabled} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder="What should the hosts talk about?" className={`${inputClass} resize-none`} />

      <div className="mt-3">
        <label className="mono mb-1.5 block text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">STYLE</label>
        <input value={style} disabled={disabled} onChange={(e) => setStyle(e.target.value)} placeholder={DEFAULT_STYLE} className={inputClass} />
      </div>

      {!script ? (
        <StepFooter>
          <button onClick={create} disabled={disabled || !topic.trim()} className="btn btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
            {running ? "Writing…" : "Write the script & voices"}
          </button>
        </StepFooter>
      ) : (
        <>
          <div className="mt-5 mb-2 flex items-center justify-between">
            <div className="mono text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">
              {turns.length} TURNS{script.title ? ` · ${script.title}` : ""}
              {edited && <span className="ml-1 text-[var(--color-warn)]">· unsaved…</span>}
            </div>
            <button onClick={rewrite} disabled={disabled} className="mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">↻ rewrite</button>
          </div>

          <div className="space-y-1.5">
            {draft.map((t, i) => {
              const host = project!.config.hosts.find((h) => h.id === t.hostId) ?? project!.config.hosts[0];
              const color = providerColor(providerOfModel(host.model));
              return (
                <div key={i} className="group flex gap-2.5 border border-[var(--color-hairline)] p-2">
                  <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    <span className="mono text-[9px] text-[var(--color-text-muted)]">{host.name}</span>
                  </div>
                  <textarea
                    value={t.text}
                    disabled={disabled}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                    rows={2}
                    className="min-h-0 w-full resize-none border-0 bg-transparent text-[13px] leading-snug outline-none focus:bg-[var(--color-surface-2)] disabled:opacity-60"
                  />
                  <button
                    onClick={() => void removeTurn(i)}
                    disabled={disabled || draft.length <= 2}
                    title={draft.length <= 2 ? "A conversation needs at least two lines" : "Delete this line"}
                    aria-label={`Delete turn ${i + 1}`}
                    className="mono h-fit shrink-0 px-1 text-[11px] text-[var(--color-text-muted)] opacity-0 hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <StepFooter>
            {edited ? (
              <button onClick={applyEdits} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">{running ? "Re-voicing…" : "Re-voice edits"}</button>
            ) : !hasSpeech ? (
              <button onClick={revoice} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">{running ? "Synthesizing…" : "Synthesize voices"}</button>
            ) : (
              <button onClick={() => ctx.go(3)} disabled={disabled} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">Next: Generate videos →</button>
            )}
          </StepFooter>
        </>
      )}
    </div>
  );
}
