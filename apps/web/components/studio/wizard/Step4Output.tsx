"use client";

import { downloadHref, downloadText, toSrt, toVtt } from "@/components/studio/export";
import { useWizard } from "./context";
import { StepHeader, StepFooter } from "./ui";

export function Step4Output() {
  const ctx = useWizard();
  const { project, slug, locked, busy, running } = ctx;
  const disabled = locked || busy;
  const done = project?.stages.render === "done" && !!project?.videoUrl;
  const regions = project?.speech?.turns ?? [];
  const audioExt = project?.audioUrl?.split("?")[0].split(".").pop() || "mp3";
  const quality = project?.options?.renderQuality ?? "high";

  async function render() {
    await ctx.generate({ to: "render" });
  }
  // Re-encode only — reuse the script/voices/clips/b-roll, rebuild just the composition + MP4.
  // (To change the actual content, go back to the relevant step; that invalidates the render.)
  async function reRender() {
    await ctx.generate({ only: ["compose", "render"], force: true });
  }

  return (
    <div>
      <StepHeader title={done ? "Your video is ready" : "Render the video"} hint={done ? "Watch it in the preview. Re-render anytime, or export the pieces." : "Composites your generated clips with captions and b-roll, then renders the final MP4. (Nothing gets animated here — that happens in the Videos step.)"} />

      <div className="mb-4 space-y-1.5">
        <div className="flex items-center justify-between border border-[var(--color-hairline)] px-3 py-2">
          <span>
            <span className="block text-[13px] font-medium">Render quality</span>
            <span className="block text-[11px] text-[var(--color-text-muted)]">draft is ~2× faster — switch to high for the final export</span>
          </span>
          <div className="flex gap-1">
            {(["draft", "high"] as const).map((q) => (
              <button
                key={q}
                onClick={() => quality !== q && void ctx.patch({ options: { renderQuality: q } })}
                disabled={disabled}
                className="mono border px-2 py-0.5 text-[10px] disabled:opacity-50"
                style={{
                  borderColor: quality === q ? "var(--color-accent)" : "var(--color-hairline)",
                  color: quality === q ? "var(--color-accent)" : "var(--color-text-muted)",
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!done ? (
        <button onClick={render} disabled={disabled} className="btn btn-primary w-full py-3 text-sm disabled:opacity-50">
          {running ? "Rendering…" : "Render the video"}
        </button>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button onClick={() => project?.videoUrl && downloadHref(`${slug}.mp4`, project.videoUrl)} className="btn btn-primary px-4 py-2 text-sm">↓ MP4</button>
            {project?.audioUrl && <button onClick={() => downloadHref(`${slug}.${audioExt}`, project.audioUrl!)} className="btn btn-ghost px-3 py-2 text-sm">↓ audio</button>}
            {regions.length > 0 && <button onClick={() => downloadText(`${slug}.srt`, toSrt(regions))} className="btn btn-ghost px-3 py-2 text-sm">↓ SRT</button>}
            {regions.length > 0 && <button onClick={() => downloadText(`${slug}.vtt`, toVtt(regions), "text/vtt")} className="btn btn-ghost px-3 py-2 text-sm">↓ VTT</button>}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={reRender} disabled={disabled} className="mono text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40">↻ re-render</button>
            {quality === "draft" && <span className="mono text-[10px] text-[var(--color-warn)]">rendered in draft quality</span>}
          </div>
        </>
      )}

      <StepFooter>
        <a href="/studio?new=1" className="mono text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">+ new video</a>
      </StepFooter>
    </div>
  );
}
