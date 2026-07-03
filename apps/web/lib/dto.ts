import { providerOfModel, providerColor } from "@/lib/providers";
import type { ProjectState } from "@podframes/core";

/**
 * The one place the on-disk ProjectState is shaped into the disk→server→client DTO.
 * Routes return these; the client derives its type via `ReturnType` (see studio/api.ts),
 * so server and client can never silently drift. Type-only `@podframes/core` import —
 * importing this module never pulls the pipeline into a bundle.
 */

/** Card-level view for the sessions grid. */
export function projectSummary(state: ProjectState) {
  return {
    slug: state.slug,
    topic: state.config.topic,
    title: state.script?.title ?? null,
    updatedAt: state.updatedAt,
    durationSec: state.output?.durationSec ?? state.speech?.durationSec ?? null,
    hasOutput: !!state.output,
    videoUrl: state.output ? `/api/media/${state.slug}/${state.output.videoPath}` : null,
    hosts: state.config.hosts.map((h) => {
      const provider = providerOfModel(h.model);
      return { name: h.name, model: h.model, provider, color: providerColor(provider) };
    }),
    stages: Object.fromEntries(
      Object.entries(state.stages).map(([k, v]) => [k, v?.status ?? "pending"]),
    ),
  };
}

/** Full editor view for one project. */
export function projectDetail(state: ProjectState) {
  return {
    ...projectSummary(state),
    hook: state.script?.hook ?? null,
    script: state.script ?? null,
    // Bumps when the script stage (re)RUNS (markRunning sets startedAt), NOT on an edit-save
    // (markDone preserves it) — so the editor re-seeds its draft on a rewrite but never on autosave.
    scriptVersion: state.stages.script?.startedAt ?? null,
    cues: state.broll?.cues ?? null,
    speech: state.speech
      ? {
          durationSec: state.speech.durationSec,
          turns: state.speech.turns,
          // Changes ONLY when the speech stage re-runs — so the studio remounts the
          // <audio> on a real re-synth, not on every unrelated edit (caption/b-roll).
          version: state.stages.speech?.finishedAt ?? state.updatedAt,
        }
      : null,
    stills: state.stills ?? null,
    uploads: state.uploads ?? null,
    clips: state.clips?.clips ?? null,
    // Media-cache version for clip/still URLs: bumps when the video stage last
    // produced output, NOT on every project save — an unrelated autosave must not
    // remount and refetch every <video> in the studio.
    clipsVersion: state.stages.video?.finishedAt ?? state.stages.video?.startedAt ?? null,
    stillsVersion: state.stages.stills?.finishedAt ?? state.updatedAt,
    // Persisted per-stage errors, so a failure is still explainable after a
    // reload (the live SSE line is gone by then).
    stageErrors: Object.fromEntries(
      Object.entries(state.stages).flatMap(([k, v]) =>
        v?.status === "error" && v.error ? [[k, v.error]] : [],
      ),
    ) as Record<string, string>,
    audioUrl: state.speech ? `/api/media/${state.slug}/${state.speech.audioPath}` : null,
    options: state.options,
    config: state.config,
  };
}

export type ProjectSummary = ReturnType<typeof projectSummary>;
export type ProjectDetail = ReturnType<typeof projectDetail> & {
  /** True while the RunManager has a live run for this project (set by lib/projects). */
  runActive?: boolean;
};
