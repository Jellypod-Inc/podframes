"use client";

import { useEffect, useState } from "react";
import { ROSTER, rosterThumb } from "@/lib/roster";
import { uploadHostPhoto } from "@/components/studio/api";
import { useWizard } from "./context";
import { doneStageLabels } from "./Step1Cast";
import { castToHosts } from "./cast";
import type { CastChannel } from "./cast";

/** Per-host face picker: choose a roster default or upload a photo.
 *  Each source is select/input → explicit action; nothing applies until you confirm. */
export function FaceDialog({ index, ch, onClose }: { index: number; ch: CastChannel; onClose: () => void }) {
  const ctx = useWizard();
  const [selected, setSelected] = useState<string | null>(ch.rosterKey ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string>("");
  const [busy, setBusy] = useState<"choose" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarStages = doneStageLabels(ctx.project, ["stills", "video", "compose", "render"]);

  useEffect(() => () => { if (filePreview) URL.revokeObjectURL(filePreview); }, [filePreview]);

  function pickFile(f: File) {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  }

  async function confirmAvatarChange(): Promise<boolean> {
    if (!avatarStages.length) return true;
    return ctx.confirm({
      title: "Change avatar?",
      body: "This replaces the base avatar image used for video generation.",
      details: [
        `Will clear: ${avatarStages.join(", ")}.`,
        "Existing generated media will stay unavailable until you regenerate the relevant step.",
      ],
      confirmLabel: "Change avatar",
      tone: "warn",
    });
  }

  // Apply only the visual identity; voice/model settings are independent.
  async function chooseDefault() {
    const r = ROSTER.find((x) => x.key === selected);
    if (!r) return;
    setBusy("choose");
    setError(null);
    try {
      if (!(await confirmAvatarChange())) return;
      const nextCast = ctx.cast.map((c, i) => (i === index ? { ...c, name: r.name, appearance: r.appearance, rosterKey: r.key } : c));
      ctx.setCast(() => nextCast);
      if (ctx.slug && ctx.project) await ctx.patch({ hosts: castToHosts(nextCast) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function useUpload() {
    if (!file) return;
    setBusy("upload");
    setError(null);
    try {
      if (!(await confirmAvatarChange())) return;
      const slug = await ctx.ensureProject();
      if (!slug) throw new Error("couldn't create the project");
      await uploadHostPhoto(slug, ch.id, file);
      ctx.setCast((cs) => cs.map((c, i) => (i === index ? { ...c, rosterKey: undefined } : c)));
      await ctx.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={() => !working && onClose()}>
      <div className="w-full max-w-md border border-[var(--color-hairline)] bg-[var(--color-surface)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-4 py-3">
          <span className="mono text-[11px] tracking-[0.09em] text-[var(--color-text-muted)]">CH {String.fromCharCode(65 + index)} · FACE</span>
          <button onClick={onClose} disabled={working} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40" aria-label="Close">✕</button>
        </div>

        <div className="space-y-5 p-4">
          {/* 1 — a roster default: select, then Choose */}
          <section>
            <div className="mono mb-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">PICK A DEFAULT HOST</div>
            <div className="grid grid-cols-3 gap-2">
              {ROSTER.map((r) => {
                const on = selected === r.key;
                return (
                  <button key={r.key} onClick={() => { setSelected(r.key); setFile(null); }} disabled={working} className="flex flex-col items-center gap-1 border p-1.5 disabled:opacity-50" style={{ borderColor: on ? "var(--color-accent)" : "var(--color-hairline)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={rosterThumb(r.key)} alt={r.name} className="h-14 w-14 object-cover" />
                    <span className="text-[11px]" style={{ color: on ? "var(--color-accent)" : "var(--color-text-secondary)" }}>{r.name}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={chooseDefault} disabled={working || !selected} className="btn btn-ghost mt-2 w-full py-2 text-sm disabled:opacity-40">{busy === "choose" ? "Choosing…" : "Choose"}</button>
          </section>

          {/* 2 — upload: pick a file, preview, then Use */}
          <section className="border-t border-[var(--color-hairline)] pt-4">
            <div className="mono mb-2 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">UPLOAD A PHOTO</div>
            {file ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={filePreview} alt="" className="h-16 w-16 border border-[var(--color-hairline)] object-cover" />
                <div className="flex-1 space-y-1.5">
                  <div className="truncate text-[12px] text-[var(--color-text-secondary)]">{file.name}</div>
                  <div className="flex gap-2">
                    <button onClick={useUpload} disabled={working} className="btn btn-primary flex-1 py-1.5 text-xs disabled:opacity-50">{busy === "upload" ? "Uploading…" : "Use this photo"}</button>
                    <label className="btn btn-ghost cursor-pointer px-3 py-1.5 text-xs">
                      Change
                      <input type="file" accept="image/*" disabled={working} className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <label className={`flex items-center justify-center gap-2 border border-dashed border-[var(--color-hairline)] py-3 text-sm text-[var(--color-text-secondary)] ${working ? "opacity-50" : "cursor-pointer hover:border-[var(--color-accent)]"}`}>
                ⬆ Choose a photo
                <input type="file" accept="image/*" disabled={working} className="hidden" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
              </label>
            )}
          </section>

          {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
