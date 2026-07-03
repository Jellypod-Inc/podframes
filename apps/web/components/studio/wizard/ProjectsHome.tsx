"use client";

import { useState } from "react";
import { deleteProject } from "@/components/studio/api";
import type { ProjectSummary } from "@/lib/dto";
import { clearStudioDraft } from "./draft-storage";

const STAGES = ["script", "speech", "stills", "video", "broll", "compose", "render"];

/** The projects library — open or delete each video; start a new one. */
export function ProjectsHome({ projects: initial }: { projects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initial);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function remove(slug: string) {
    setBusy(slug);
    setDeleteError(null);
    try {
      await deleteProject(slug);
      clearStudioDraft(slug);
      setProjects((ps) => ps.filter((p) => p.slug !== slug));
      setConfirm(null);
    } catch (e) {
      // Surface the reason (e.g. the 409 "run in progress" message) in the overlay.
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your videos</h1>
          <span className="mono text-xs text-[var(--color-text-muted)]">topic → watchable conversation</span>
        </div>
        <a href="/studio?new=1" className="btn btn-primary px-4 py-2 text-sm">+ New video</a>
      </div>

      {projects.length === 0 ? (
        <div className="border border-dashed border-[var(--color-hairline)] py-16 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">No videos yet.</p>
          <a href="/studio?new=1" className="btn btn-primary mt-4 px-4 py-2 text-sm">Start your first</a>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.slug} className="panel relative overflow-hidden transition-colors hover:border-[var(--color-text-muted)]">
              <a href={`/studio?slug=${p.slug}`} className="block">
                <div className="aspect-video bg-[var(--color-surface-2)]">
                  {p.hasOutput && p.videoUrl ? (
                    <video src={p.videoUrl} muted className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-[var(--color-text-muted)]">not rendered</div>
                  )}
                </div>
                <div className="p-3">
                  <div className="truncate pr-7 text-sm font-medium">{p.title || p.topic}</div>
                  <div className="mt-1 flex items-center gap-2">
                    {p.hosts.map((h, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.color }} />{h.name}
                      </span>
                    ))}
                    <span className="mono ml-auto text-[10px] text-[var(--color-text-muted)]">{p.durationSec ? `${p.durationSec.toFixed(0)}s` : "draft"}</span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {STAGES.map((s) => {
                      const st = p.stages[s];
                      return <span key={s} className="h-1.5 flex-1" style={{ background: st === "done" ? "var(--color-success)" : st === "error" ? "var(--color-danger)" : st === "running" ? "var(--color-accent)" : "var(--color-hairline)" }} title={s} />;
                    })}
                  </div>
                </div>
              </a>

              <button
                onClick={() => setConfirm(p.slug)}
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center bg-[#100f0ecc] text-[13px] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                title="Delete video"
                aria-label={`Delete ${p.title || p.topic}`}
              >
                🗑
              </button>

              {confirm === p.slug && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#100f0eee] p-4 text-center">
                  <p className="text-sm">Delete this video?<br /><span className="text-[12px] text-[var(--color-text-muted)]">Permanent — can&apos;t be undone.</span></p>
                  {deleteError && <p className="text-[11px] text-[var(--color-danger)]">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setConfirm(null); setDeleteError(null); }} disabled={busy === p.slug} className="btn btn-ghost px-3 py-1.5 text-xs">Cancel</button>
                    <button onClick={() => remove(p.slug)} disabled={busy === p.slug} className="rounded-none border border-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[#100f0e] disabled:opacity-50">
                      {busy === p.slug ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
