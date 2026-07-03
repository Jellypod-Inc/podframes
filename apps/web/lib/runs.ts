import { generateProject, isRunActive, runLockFile, Project, type PipelineEvent, type StageName } from "@podframes/core";
import { findRepoRoot } from "@/lib/root";

/**
 * The RunManager: pipeline runs live HERE, not inside an HTTP request.
 *
 * POST /api/generate registers a run and returns immediately; the browser (or
 * any number of browsers, or a browser that reloaded mid-run) attaches to
 * GET /api/projects/[slug]/run, which replays the buffered events and then
 * follows live. Closing the tab detaches a listener — the run itself keeps
 * going. DELETE aborts it cooperatively (stage boundaries + worker pools).
 *
 * The registry lives on globalThis so Next dev-server HMR recompiles can't
 * orphan an in-flight run's record.
 */

export interface RunEvent {
  seq: number;
  type: "start" | "event" | "done" | "error";
  event?: PipelineEvent;
  message?: string;
  done?: DonePayload;
  at: string;
}

export interface DonePayload {
  type: "done";
  slug: string;
  title: string | null;
  hook: string | null;
  turns: unknown;
  audioUrl: string | null;
  durationSec: number | null;
  videoUrl: string | null;
  output: unknown;
  stages: Record<string, string>;
}

export interface RunRecord {
  slug: string;
  status: "running" | "done" | "error";
  startedAt: string;
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  controller: AbortController;
  seq: number;
}

const MAX_BUFFER = 600;

const registry: Map<string, RunRecord> = ((globalThis as Record<string, unknown>).__podframesRuns ??=
  new Map<string, RunRecord>()) as Map<string, RunRecord>;

export const getRun = (slug: string): RunRecord | undefined => registry.get(slug);

/** True while a run registered through this manager is in flight for the slug. */
export const isRunActiveWeb = (slug: string): boolean => registry.get(slug)?.status === "running";

/** True for a live run ANYWHERE: this manager, core's in-process registry, or
 *  another process entirely (a CLI run, via the on-disk .run.lock). */
export const isRunActiveAnywhere = (slug: string): boolean =>
  isRunActiveWeb(slug) || isRunActive(slug, runLockFile(findRepoRoot(), slug));

export interface StartRunOptions {
  from?: StageName;
  to?: StageName;
  only?: StageName[];
  force?: boolean;
  onlyTurns?: number[];
}

export interface StartResult {
  ok: boolean;
  status: number;
  message?: string;
}

export async function startRun(slug: string, opts: StartRunOptions): Promise<StartResult> {
  if (isRunActiveWeb(slug)) {
    return { ok: false, status: 409, message: `A run is already in progress for "${slug}".` };
  }
  const root = findRepoRoot();
  const project = await Project.load(root, slug);
  if (!project) return { ok: false, status: 404, message: `project "${slug}" not found` };

  const run: RunRecord = {
    slug,
    status: "running",
    startedAt: new Date().toISOString(),
    events: [],
    listeners: new Set(),
    controller: new AbortController(),
    seq: 0,
  };
  registry.set(slug, run);
  push(run, { type: "start" });

  // Fire and forget — the run outlives this request.
  void (async () => {
    try {
      const finished = await generateProject(project, {
        root,
        console: false,
        signal: run.controller.signal,
        ...(opts.from ? { from: opts.from } : {}),
        ...(opts.to ? { to: opts.to } : {}),
        ...(opts.only?.length ? { only: opts.only } : {}),
        ...(opts.force ? { force: true } : {}),
        ...(opts.onlyTurns?.length ? { onlyTurns: opts.onlyTurns } : {}),
        onEvent: (event) => push(run, { type: "event", event }),
      });
      run.status = "done";
      push(run, { type: "done", done: donePayload(finished) });
    } catch (err) {
      run.status = "error";
      push(run, { type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  })();

  return { ok: true, status: 202 };
}

export function cancelRun(slug: string): boolean {
  const run = registry.get(slug);
  if (!run || run.status !== "running") return false;
  run.controller.abort();
  return true;
}

/** Attach a listener; the caller replays `events` up to the returned snapshot
 *  length itself, then receives only newer events (seq-gated — no gap, no dupe). */
export function subscribe(slug: string, listener: (e: RunEvent) => void): (() => void) | null {
  const run = registry.get(slug);
  if (!run) return null;
  run.listeners.add(listener);
  return () => run.listeners.delete(listener);
}

function push(run: RunRecord, e: Omit<RunEvent, "seq" | "at">): void {
  const full: RunEvent = { ...e, seq: run.seq++, at: new Date().toISOString() };
  run.events.push(full);
  if (run.events.length > MAX_BUFFER) run.events.splice(0, run.events.length - MAX_BUFFER);
  for (const l of run.listeners) {
    try {
      l(full);
    } catch {
      /* a bad listener must never break the run */
    }
  }
}

function donePayload(project: Project): DonePayload {
  const s = project.state;
  return {
    type: "done",
    slug: project.slug,
    title: s.script?.title ?? null,
    hook: s.script?.hook ?? null,
    turns: s.script?.turns ?? null,
    audioUrl: s.speech ? `/api/media/${project.slug}/${s.speech.audioPath}` : null,
    durationSec: s.output?.durationSec ?? s.speech?.durationSec ?? null,
    videoUrl: s.output ? `/api/media/${project.slug}/${s.output.videoPath}` : null,
    output: s.output ?? null,
    stages: Object.fromEntries(Object.entries(s.stages).map(([k, v]) => [k, v?.status ?? "pending"])),
  };
}
