"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProject, patchProject, createProject, type ProjectDetail, type PatchBody } from "@/components/studio/api";
import { useRun } from "@/components/studio/useRun";
import { TransportProvider } from "@/components/studio/transport";
import {
  WizardProvider,
  STEPS,
  resumeStep,
  maxStepFor,
  type WizardCtx,
  type GenerateOpts,
  type ConfirmOptions,
  type ClipTrimDraft,
} from "./context";
import { defaultCast, castFromHosts, castToHosts, configFrom, type CastChannel, type Aspect } from "./cast";
import { Step1Cast } from "./Step1Cast";
import { Step2Script } from "./Step2Script";
import { Step3Videos } from "./Step3Videos";
import { Step3Look } from "./Step3Look";
import { Step4Output } from "./Step4Output";
import { Preview } from "./Preview";
import { clearStudioDraft, readStudioDraft, writeStudioDraft } from "./draft-storage";

const clamp = (lo: number, hi: number, n: number) => Math.max(lo, Math.min(hi, n));

function hostsKey(hosts: Array<ProjectDetail["config"]["hosts"][number]>): string {
  return JSON.stringify(
    hosts.map((h) => [
      h.name,
      h.model,
      h.voice,
      h.persona,
      h.appearance,
      h.avatarKey,
      h.defaultStability,
      h.defaultStyle,
      h.flip,
    ]),
  );
}

const HEALTH_LABELS: Record<string, string> = {
  speechbase: "SPEECHBASE_API_KEY — the mixed conversation audio",
  gemini: "GEMINI_API_KEY — script, stills, b-roll",
  replicate: "REPLICATE_API_KEY — the default lip-sync video provider",
  ffmpeg: "ffmpeg on PATH — audio/video processing",
};

type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };

/** Key/binary status dots — misconfiguration is visible up-front instead of one
 *  stage-failure at a time. Hover a dot for what it unlocks. */
function HealthDots() {
  const [health, setHealth] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => {});
  }, []);
  if (!health) return null;
  return (
    <div className="hidden items-center gap-1.5 sm:flex" aria-label="Environment status">
      {Object.entries(HEALTH_LABELS).map(([key, label]) => (
        <span
          key={key}
          title={`${label} — ${health[key] ? "configured" : "MISSING"}`}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: health[key] ? "var(--color-success)" : "var(--color-danger)" }}
        />
      ))}
    </div>
  );
}

export function Wizard({ initial, initialStep }: { initial: ProjectDetail | null; initialStep?: number }) {
  const [project, setProject] = useState<ProjectDetail | null>(initial);
  const [slug, setSlug] = useState<string | null>(initial?.slug ?? null);
  // Prefer the step from the URL (?step=) so a refresh stays put; else resume the first incomplete step.
  const [step, setStep] = useState<number>(initialStep ?? resumeStep(initial));
  const [cast, setCast] = useState<CastChannel[]>(initial ? castFromHosts(initial.config.hosts) : defaultCast());
  const [topic, setTopic] = useState(initial?.config.topic ?? "What makes a good cold open?");
  const [style, setStyle] = useState(initial?.config.styleNote ?? "");
  const [aspect, setAspect] = useState<Aspect>((initial?.config.aspectRatio as Aspect) ?? "9:16");
  const [resolution, setResolution] = useState<"720p" | "1080p">(initial?.options?.videoResolution ?? "720p");
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [dismissedErr, setDismissedErr] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  // "This edit cleared: video, compose, render" — a paid artifact must never
  // silently vanish after an edit (the #1 'my videos disappeared' confusion).
  const [clearedNotice, setClearedNotice] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [clipTrimDrafts, setClipTrimDrafts] = useState<Record<string, ClipTrimDraft>>({});
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { start, attach, cancel, running, log, error: runError } = useRun();
  // The last cast persist in flight — generate() awaits it so a run can never
  // race the PATCH (which would 409 against the active run and silently drop).
  const persistPending = useRef<Promise<void> | null>(null);

  const maxStep = maxStepFor(project);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => (
    new Promise((resolve) => setConfirmRequest({ ...opts, resolve }))
  ), []);

  const resolveConfirm = useCallback((ok: boolean) => {
    setConfirmRequest((req) => {
      req?.resolve(ok);
      return null;
    });
  }, []);

  const refreshSlug = useCallback(async (s: string | null) => {
    if (!s) return;
    try {
      setProject(await getProject(s));
    } catch {
      /* keep last good */
    }
  }, []);

  // Lazily create the project so Step-1 face actions (upload / generate) work before a topic exists.
  const ensureProject = useCallback(async (): Promise<string | null> => {
    if (slug) return slug;
    setEditError(null);
    try {
      const detail = await createProject(configFrom(cast, topic, style, aspect, resolution));
      clearStudioDraft(null);
      setSlug(detail.slug);
      setProject(detail);
      return detail.slug;
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [slug, cast, topic, style, aspect, resolution]);

  const generate = useCallback(
    async (opts: GenerateOpts) => {
      setEditError(null);
      setDismissedErr(null);
      await persistPending.current?.catch(() => {});
      // Every run goes through the uniqueSlug create path first — core never
      // derives a slug from the topic here, so a prefilled/duplicate topic can
      // never silently resume someone else's project.
      const s = slug ?? (await ensureProject());
      if (!s) return null;
      const done = await start({
        slug: s,
        ...(opts.only ? { only: opts.only } : {}),
        ...(opts.to ? { to: opts.to } : {}),
        ...(opts.force ? { force: true } : {}),
        ...(opts.onlyTurns?.length ? { onlyTurns: opts.onlyTurns } : {}),
      });
      await refreshSlug(s);
      return done;
    },
    [slug, ensureProject, start, refreshSlug],
  );

  const patch = useCallback(
    async (body: PatchBody, opts?: { silent?: boolean }) => {
      if (!slug) return;
      if (!opts?.silent) setBusy(true);
      setEditError(null);
      try {
        const resp = await patchProject(slug, body);
        // Surface what the edit invalidated — server-side clears delete real
        // (often paid) artifacts, and silence here reads as "my videos vanished".
        const parts: string[] = [];
        if (resp.clearedTurns?.length) parts.push(`audio + clips for ${resp.clearedTurns.length} turn${resp.clearedTurns.length === 1 ? "" : "s"}`);
        if (resp.cleared?.length) parts.push(resp.cleared.join(", "));
        if (parts.length) {
          setClearedNotice(`this edit cleared: ${parts.join(" · ")} — regenerate on the relevant step`);
          if (noticeTimer.current) clearTimeout(noticeTimer.current);
          noticeTimer.current = setTimeout(() => setClearedNotice(null), 10_000);
        }
        await refreshSlug(slug);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!opts?.silent) setBusy(false);
      }
    },
    [slug, refreshSlug],
  );

  // Commit Step-1 cast edits whenever the user leaves Step 1 — via Next OR the rail —
  // so a voice/identity change can't be silently dropped (and correctly invalidates downstream).
  const persistCast = useCallback(async (opts?: { silent?: boolean }) => {
    if (!slug || !project) return;
    if (hostsKey(project.config.hosts) !== hostsKey(castToHosts(cast))) {
      await patch({ hosts: castToHosts(cast) }, opts);
    }
  }, [slug, project, cast, patch]);

  const go = useCallback(
    (n: number) => {
      const target = clamp(1, maxStep, n);
      // Navigation stays instant; generate() awaits this pending promise so a
      // run can't start until the cast PATCH has landed.
      if (step === 1 && target !== 1) persistPending.current = persistCast();
      setStep(target);
    },
    [maxStep, step, persistCast],
  );

  // Reattach: if the server has a live run for this project (opened mid-run, a
  // reload, or a second tab), follow it instead of showing a dead locked UI.
  useEffect(() => {
    if (project?.runActive && !running && slug) {
      void attach(slug).then(() => refreshSlug(slug));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.runActive, slug]);

  // Restore refresh-safe local choices before any draft writes happen. This is
  // the one intentional state sync from external browser storage.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const draft = readStudioDraft(slug);
    if (draft?.cast) setCast(draft.cast);
    if (draft?.topic != null) setTopic(draft.topic);
    if (draft?.style != null) setStyle(draft.style);
    if (draft?.aspect) setAspect(draft.aspect);
    if (draft?.resolution) setResolution(draft.resolution);
    setDraftReady(true);
    // Read once on mount; slug changes are caused by creating a project from the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keep the current studio draft refresh-safe even before a project exists.
  useEffect(() => {
    if (!draftReady) return;
    writeStudioDraft(slug, { cast, topic, style, aspect, resolution });
  }, [draftReady, slug, cast, topic, style, aspect, resolution]);

  // If an edit dropped maxStep below the current step, never render a step the rail can't reach.
  const effectiveStep = Math.min(step, maxStep);

  // Pin the real step down to maxStep DURING RENDER (converges — after this, step <= maxStep), so a
  // stale/URL ?step above what's been generated can't later spring the user forward when maxStep recovers.
  if (step > maxStep) setStep(maxStep);

  // Keep the URL in sync so a refresh restores the exact project + step (no forward jump).
  useEffect(() => {
    if (slug) window.history.replaceState(null, "", `/studio?slug=${slug}&step=${effectiveStep}`);
  }, [slug, effectiveStep]);

  // Step-1 edits should survive refresh without requiring the user to click Next.
  // Debounce project writes so text/slider edits do not fight the active control.
  useEffect(() => {
    if (!draftReady || !slug || !project || running || project.runActive || effectiveStep !== 1) return;
    if (hostsKey(project.config.hosts) === hostsKey(castToHosts(cast))) return;
    const id = setTimeout(() => {
      persistPending.current = persistCast({ silent: true });
    }, 600);
    return () => clearTimeout(id);
  }, [draftReady, slug, project, running, effectiveStep, cast, persistCast]);

  // Persisted stage failures (survive reloads — the live SSE error line doesn't).
  const stageErrEntry = !running ? Object.entries(project?.stageErrors ?? {})[0] : undefined;
  const stageErr = stageErrEntry && stageErrEntry[1] !== dismissedErr ? stageErrEntry : undefined;

  const ctx: WizardCtx = useMemo(
    () => ({
      slug,
      project,
      step: effectiveStep,
      maxStep,
      go,
      cast,
      setCast,
      topic,
      setTopic,
      style,
      setStyle,
      aspect,
      setAspect,
      resolution,
      setResolution,
      busy,
      running,
      locked: running || !!project?.runActive,
      error: runError ?? editError,
      log,
      clipTrimDrafts,
      setClipTrimDrafts,
      generate,
      confirm,
      patch,
      refresh: () => refreshSlug(slug),
      ensureProject,
    }),
    [slug, project, effectiveStep, maxStep, go, cast, topic, style, aspect, resolution, busy, running, runError, editError, log, clipTrimDrafts, generate, confirm, patch, refreshSlug, ensureProject],
  );

  const audioUrl = project?.audioUrl ?? null;
  const audioVersion = project?.speech?.version ?? project?.updatedAt ?? "none";
  const duration = project?.speech?.durationSec ?? 0;
  const displayError = runError ?? editError;

  // Component names are historical (Step3Look/Step4Output predate the Videos step being
  // inserted at rail position 3) — the array position is what actually maps to STEPS[].n.
  const StepBody = [Step1Cast, Step2Script, Step3Videos, Step3Look, Step4Output][effectiveStep - 1] ?? Step1Cast;
  const latest = log[log.length - 1];

  return (
    <WizardProvider value={ctx}>
      <div className="flex min-h-[100dvh] flex-col bg-[var(--color-bg)]">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-hairline)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <a href="/studio" className="mono shrink-0 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="All videos">‹ all</a>
            <span className="hidden text-[var(--color-hairline)] sm:inline">/</span>
            <span className="mono hidden text-[11px] tracking-[0.12em] text-[var(--color-text-muted)] sm:inline">SPEECHBASE STUDIO</span>
            {(project?.title || (slug && topic)) && (
              <>
                <span className="text-[var(--color-hairline)]">/</span>
                <span className="truncate text-[13px] text-[var(--color-text-secondary)]">{project?.title || topic}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <HealthDots />
            <span className="mono border border-[var(--color-hairline)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
              {aspect} · {project?.options?.videoResolution ?? resolution}
            </span>
          </div>
        </header>

        {/* Step rail */}
        <nav className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-[var(--color-hairline)] px-4 py-3">
          {STEPS.map((s, i) => {
            const active = s.n === effectiveStep;
            const reachable = s.n <= maxStep;
            const done = !!project && s.n < resumeStep(project) && s.n <= maxStep;
            return (
              <div key={s.n} className="flex items-center">
                {i > 0 && <div className="mx-2 h-px w-5 shrink-0 bg-[var(--color-hairline)] sm:w-7" />}
                <button
                  onClick={() => reachable && go(s.n)}
                  disabled={!reachable}
                  className="flex shrink-0 items-center gap-2 disabled:cursor-not-allowed"
                  aria-current={active ? "step" : undefined}
                >
                  <span
                    className="flex h-[22px] w-[22px] items-center justify-center text-[12px] font-medium"
                    style={{
                      background: active ? "var(--color-accent)" : "var(--color-surface-2)",
                      color: active ? "var(--color-accent-fg)" : done ? "var(--color-success)" : "var(--color-text-muted)",
                    }}
                  >
                    {done && !active ? "✓" : s.n}
                  </span>
                  <span
                    className="whitespace-nowrap text-[13px]"
                    style={{ color: active ? "var(--color-accent)" : reachable ? "var(--color-text-secondary)" : "var(--color-text-muted)", fontWeight: active ? 500 : 400 }}
                  >
                    {s.label}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Live run status — one friendly line, not a console — plus Stop. */}
        {(running || displayError) && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-2 text-[12px]">
            {running ? (
              <>
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                <span className="mono min-w-0 flex-1 truncate text-[var(--color-text-secondary)]">{latest ? latest.message : "Working…"}</span>
                {slug && (
                  <button
                    onClick={() => void cancel(slug)}
                    className="mono shrink-0 border border-[var(--color-hairline)] px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                    title="Stop after the current step finishes its in-flight work"
                  >
                    stop
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]" />
                <span className="truncate text-[var(--color-danger)]">{displayError}</span>
              </>
            )}
          </div>
        )}

        {/* What the last edit invalidated — visible, so cleared clips are never a mystery. */}
        {clearedNotice && !running && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-2 text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--color-warn)]">{clearedNotice}</span>
            <button onClick={() => setClearedNotice(null)} className="mono shrink-0 px-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* A stage failed on a previous run (persisted) — say so, don't just grey out. */}
        {!running && !displayError && stageErr && (
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-2 text-[12px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-danger)]" />
            <span className="min-w-0 flex-1 truncate text-[var(--color-danger)]" title={stageErr[1]}>
              {stageErr[0]} failed: {stageErr[1]}
            </span>
            <button
              onClick={() => setDismissedErr(stageErr[1])}
              className="mono shrink-0 px-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Body: step (left) + persistent preview (right). Transport wraps BOTH — not just
            Preview — so a step body (e.g. b-roll cue timing) can scrub/read the same playhead
            the preview shows, not just watch it. */}
        <TransportProvider
          src={audioUrl ? `${audioUrl}?v=${encodeURIComponent(String(audioVersion))}` : null}
          srcKey={(audioUrl ?? "none") + String(audioVersion)}
          durationSec={duration}
        >
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_clamp(300px,32vw,400px)]">
            <main className="scroll-thin order-2 min-h-0 overflow-y-auto lg:order-1">
              <div className="mx-auto w-full max-w-2xl px-5 py-6">
                <StepBody />
              </div>
            </main>
            <aside className="order-1 border-b border-[var(--color-hairline)] lg:order-2 lg:border-b-0 lg:border-l">
              <Preview />
            </aside>
          </div>
        </TransportProvider>
        <ConfirmDialog request={confirmRequest} onResolve={resolveConfirm} />
      </div>
    </WizardProvider>
  );
}

function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest | null;
  onResolve: (ok: boolean) => void;
}) {
  if (!request) return null;
  const danger = request.tone === "danger";
  const accent = danger ? "var(--color-danger)" : "var(--color-warn)";
  const confirmLabel = request.confirmLabel ?? "Continue";
  const cancelLabel = request.cancelLabel ?? "Cancel";

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />
          <h2 id="confirm-title" className="text-sm font-semibold text-[var(--color-text)]">{request.title}</h2>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">{request.body}</p>
          {request.details?.length ? (
            <div className="space-y-1 border border-[var(--color-hairline)] bg-[var(--color-surface-2)] p-3">
              {request.details.map((d) => (
                <div key={d} className="flex gap-2 text-[12px] leading-snug text-[var(--color-text-muted)]">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ background: accent }} />
                  <span>{d}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-hairline)] px-4 py-3">
          <button onClick={() => onResolve(false)} className="btn btn-ghost px-4 py-2 text-sm">{cancelLabel}</button>
          <button
            onClick={() => onResolve(true)}
            className="border px-4 py-2 text-sm font-medium"
            style={{ borderColor: accent, color: danger ? "var(--color-danger)" : "var(--color-warn)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
