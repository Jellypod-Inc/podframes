"use client";

import { useEffect, useRef, useState } from "react";
import { PICKABLE_PROVIDERS, providerById, providerColor } from "@/lib/providers";
import { previewVoice, type ProjectDetail } from "@/components/studio/api";
import { channelToHost } from "@/components/studio/host-channel";
import { ProviderSettings, DEFAULT_STABILITY } from "@/components/studio/provider-settings";
import { useWizard } from "./context";
import { castToHosts, hostFace, type CastChannel } from "./cast";
import { FaceDialog } from "./FaceDialog";
import { StepHeader, StepFooter, inputClass } from "./ui";

const STAGE_LABELS: Record<string, string> = {
  speech: "audio",
  stills: "base avatars",
  video: "videos",
  broll: "b-roll",
  compose: "composition",
  render: "final render",
};

export function doneStageLabels(project: ProjectDetail | null, stages: string[]): string[] {
  return stages
    .filter((s) => project?.stages?.[s] === "done")
    .map((s) => STAGE_LABELS[s] ?? s);
}

export function Step1Cast() {
  const ctx = useWizard();
  const { cast, locked, aspect, project, busy } = ctx;
  const [dialogIndex, setDialogIndex] = useState<number | null>(null);
  const resolution = project?.options?.videoResolution ?? ctx.resolution;

  // Both knobs bake into the generated stills + clips, so they're chosen here
  // (before generation); changing either after paid artifacts exist re-does them.
  const paidStages = () =>
    (["stills", "video", "render"] as const).filter((s) => project?.stages?.[s] === "done");

  async function setFormat(a: "9:16" | "16:9") {
    if (a === aspect) return;
    const paid = doneStageLabels(project, paidStages());
    if (paid.length && !(await ctx.confirm({
      title: "Change format?",
      body: `Switching to ${a} changes the generated frame shape.`,
      details: [`Will clear: ${paid.join(", ")}.`, "You can regenerate those steps after the format changes."],
      confirmLabel: "Change format",
      tone: "warn",
    }))) return;
    ctx.setAspect(a);
    if (ctx.slug) void ctx.patch({ config: { aspectRatio: a } });
  }

  async function setRes(r: "720p" | "1080p") {
    if (r === resolution) return;
    const paid = doneStageLabels(project, paidStages());
    if (paid.length && !(await ctx.confirm({
      title: "Change resolution?",
      body: `Switching to ${r} changes the base images and every generated clip.`,
      details: [`Will clear: ${paid.join(", ")}.`, r === "1080p" ? "1080p costs more on P-Video Avatar." : "You can regenerate at 720p after this change."],
      confirmLabel: "Change resolution",
      tone: "warn",
    }))) return;
    ctx.setResolution(r);
    if (ctx.slug) void ctx.patch({ options: { videoResolution: r } });
  }

  return (
    <div>
      <StepHeader title="Who's talking, and how do they sound?" hint="Two hosts, each on its own voice. Click a face to pick a default or upload your own." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="mono text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">FORMAT</span>
        <div className="flex gap-1 border border-[var(--color-hairline)] p-1">
          {(["9:16", "16:9"] as const).map((a) => (
            <button key={a} onClick={() => void setFormat(a)} disabled={locked || busy} className="px-3 py-1 text-sm" style={{ background: aspect === a ? "var(--color-accent)" : "transparent", color: aspect === a ? "var(--color-accent-fg)" : "var(--color-text-secondary)" }}>{a}</button>
          ))}
        </div>
        <span className="mono ml-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">RES</span>
        <div className="flex gap-1 border border-[var(--color-hairline)] p-1">
          {(["720p", "1080p"] as const).map((r) => (
            <button key={r} onClick={() => void setRes(r)} disabled={locked || busy} className="px-3 py-1 text-sm" style={{ background: resolution === r ? "var(--color-accent)" : "transparent", color: resolution === r ? "var(--color-accent-fg)" : "var(--color-text-secondary)" }}>{r}</button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {aspect === "9:16" ? "portrait" : "landscape"}{resolution === "1080p" ? " · 1080p costs more on P-Video Avatar" : ""}
        </span>
      </div>

      <div className="space-y-3">
        {cast.map((ch, i) => (
          <HostEditor key={i} index={i} ch={ch} disabled={locked} onEditFace={() => setDialogIndex(i)} />
        ))}
      </div>

      <StepFooter>
        <button onClick={() => ctx.go(2)} disabled={locked} className="btn btn-primary px-5 py-2 text-sm disabled:opacity-50">Next: Script →</button>
      </StepFooter>

      {dialogIndex != null && cast[dialogIndex] && (
        <FaceDialog index={dialogIndex} ch={cast[dialogIndex]} onClose={() => setDialogIndex(null)} />
      )}
    </div>
  );
}

function HostEditor({ index, ch, disabled, onEditFace }: { index: number; ch: CastChannel; disabled: boolean; onEditFace: () => void }) {
  const ctx = useWizard();
  const color = providerColor(ch.provider);
  const provider = providerById(ch.provider);
  const model = provider?.models?.find((m) => m.id === ch.model) ?? provider?.models?.[0];
  const face = hostFace(ctx.project, ctx.slug, ch);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState("");
  const urlRef = useRef<string>("");
  const destructiveAck = useRef<Set<string>>(new Set());

  // Free the last sample blob when this strip unmounts.
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const update = (patch: Partial<CastChannel>) =>
    ctx.setCast((cs) => cs.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  async function confirmHostChange(kind: "voice" | "avatar" | "flip"): Promise<boolean> {
    if (destructiveAck.current.has(kind)) return true;
    const stages =
      kind === "voice"
        ? doneStageLabels(ctx.project, ["speech", "video", "broll", "compose", "render"])
        : kind === "flip"
          ? doneStageLabels(ctx.project, ["video", "compose", "render"])
          : doneStageLabels(ctx.project, ["stills", "video", "compose", "render"]);
    if (!stages.length) return true;

    const ok = await ctx.confirm({
      title: kind === "voice" ? "Change voice settings?" : kind === "flip" ? "Flip avatar?" : "Change avatar?",
      body:
        kind === "voice"
          ? "Changing the provider, voice, or voice settings re-synthesizes this host's audio and invalidates the affected generated clips."
          : kind === "flip"
            ? "Flipping the avatar is baked into generated clips, so existing videos need to be regenerated."
            : "Changing the avatar replaces the base image used for video generation.",
      details: [`Will clear: ${stages.join(", ")}.`, "Existing generated media will stay unavailable until you regenerate the relevant step."],
      confirmLabel: kind === "voice" ? "Change voice" : kind === "flip" ? "Flip avatar" : "Change avatar",
      tone: "warn",
    });
    if (ok) destructiveAck.current.add(kind);
    return ok;
  }

  async function updateVoice(patch: Partial<CastChannel>) {
    if (!(await confirmHostChange("voice"))) return;
    update(patch);
  }

  // Persist flip right away so it survives a refresh (and re-animates on the next render).
  // The patch is built from the LOCAL cast state (not the last-fetched project snapshot),
  // so flipping both hosts back-to-back can't revert the first flip.
  async function toggleFlip() {
    if (!(await confirmHostChange("flip"))) return;
    const flip = !ch.flip;
    const nextCast = ctx.cast.map((c, i) => (i === index ? { ...c, flip } : c));
    update({ flip });
    if (ctx.slug && ctx.project) {
      void ctx.patch({ hosts: castToHosts(nextCast) });
    }
  }

  async function changeProvider(pid: string) {
    if (!(await confirmHostChange("voice"))) return;
    const p = providerById(pid);
    const m = p?.models?.[0];
    update({ provider: pid, model: m?.id ?? "", voice: m?.voices[0]?.id ?? "" });
  }

  async function preview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current); // free the prior sample
      urlRef.current = await previewVoice({
        model: ch.model,
        voice: ch.voice,
        stability: ch.stability,
        style: ch.style,
        ...(sampleText.trim() ? { text: sampleText.trim() } : {}),
      });
      await new Audio(urlRef.current).play();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(
        msg.includes("SPEECHBASE_API_KEY") ? "SPEECHBASE_API_KEY not set — add it to .env.local" : msg,
      );
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3.5" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="mono mb-2.5 flex items-center justify-between text-[10px] tracking-wider text-[var(--color-text-muted)]">
        <span>ch {String.fromCharCode(97 + index)} · {provider?.label ?? ch.provider}</span>
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      </div>

      <div className="flex gap-3">
        <div className="shrink-0">
          <button
            type="button"
            onClick={onEditFace}
            disabled={disabled}
            aria-label="Edit host face"
            className="group relative block h-[68px] w-[68px] overflow-hidden bg-[var(--color-surface-2)] disabled:opacity-60"
            style={{ border: `1px solid ${color}` }}
          >
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={face} alt={ch.name} className="h-full w-full object-cover" style={{ transform: ch.flip ? "scaleX(-1)" : undefined }} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg" style={{ color, transform: ch.flip ? "scaleX(-1)" : undefined }}>{ch.name.slice(0, 1) || "?"}</div>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-[#100f0ecc] py-0.5 text-center text-[9px] text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover:opacity-100">edit</span>
          </button>
          <button
            onClick={() => void toggleFlip()}
            disabled={disabled}
            title="Flip left/right"
            aria-label="Flip left/right"
            aria-pressed={!!ch.flip}
            className="mt-1.5 flex h-6 w-[68px] items-center justify-center gap-1 border text-[12px] disabled:opacity-40"
            style={{ borderColor: ch.flip ? "var(--color-accent)" : "var(--color-hairline)", color: ch.flip ? "var(--color-accent)" : "var(--color-text-secondary)" }}
          >
            ⇄ flip
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input value={ch.name} disabled={disabled} onChange={(e) => update({ name: e.target.value })} placeholder="Name" className={`${inputClass} font-semibold`} />
          <div className="grid grid-cols-2 gap-2">
            <select value={ch.provider} disabled={disabled} onChange={(e) => void changeProvider(e.target.value)} className={inputClass}>
              {PICKABLE_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select value={ch.voice} disabled={disabled} onChange={(e) => void updateVoice({ voice: e.target.value })} className={inputClass}>
              {model?.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <ProviderSettings
        provider={ch.provider}
        providerLabel={provider?.label ?? ch.provider}
        color={color}
        host={channelToHost(ch)}
        disabled={disabled}
        stability={ch.stability ?? DEFAULT_STABILITY}
        onStability={(n) => void updateVoice({ stability: n })}
        commitStability={() => {}}
        style={ch.style ?? ""}
        onStyle={(s) => void updateVoice({ style: s })}
        commitStyle={() => {}}
      />

      <input
        value={sampleText}
        disabled={disabled}
        onChange={(e) => setSampleText(e.target.value)}
        placeholder="Audition with your own line (optional)"
        className={`${inputClass} mt-3`}
        maxLength={240}
      />
      <button onClick={preview} disabled={previewing || disabled} className="mt-2 flex w-full items-center justify-center gap-2 border px-3 py-2 text-sm font-medium disabled:opacity-60" style={{ borderColor: color, color }}>
        {previewing ? "Synthesizing…" : "▶ Preview voice"}
      </button>
      {previewError && (
        <div className="mt-1.5 text-[11px] text-[var(--color-danger)]">{previewError}</div>
      )}
    </div>
  );
}
