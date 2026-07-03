import {
  Project,
  clearStages,
  clearSpeechTurns,
  clearTurnClips,
  INVALIDATION,
  mergeOptions,
  validateOptions,
  STAGE_NAMES,
  withProjectLock,
} from "@podframes/core";
import type {
  ConversationConfig,
  Host,
  Script,
  Cue,
  PipelineOptions,
  StageName,
} from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { projectSummary } from "@/lib/dto";
import { readProjectDetail } from "@/lib/projects";
import { syncRosterAvatarUploads } from "@/lib/avatar-assets";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = await readProjectDetail(slug);
  if (!detail) return new Response("not found", { status: 404 });
  return Response.json(detail);
}

/** Permanently delete ONE project. Only dirs with a project.json qualify, so _roster is safe. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();
  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — stop it first, then delete.", { status: 409 });
  }
  return withProjectLock(safe, async () => {
    if (isRunActiveAnywhere(safe)) {
      return new Response("A generation run is in progress — stop it first, then delete.", { status: 409 });
    }
    const deleted = await Project.delete(root, safe);
    if (!deleted) return new Response("not found", { status: 404 });
    return Response.json({ ok: true, slug: safe });
  });
}

interface PatchBody {
  /** Partial conversation-level config (topic, style, turns, aspect, language). */
  config?: Partial<
    Pick<
      ConversationConfig,
      "topic" | "styleNote" | "targetTurns" | "maxWordsPerTurn" | "language" | "aspectRatio"
    >
  >;
  /** Full host array replacement (name/voice/model/side/persona/appearance). */
  hosts?: Host[];
  /** Manually edited script (turns get re-indexed; speaker re-derived from hostId). */
  script?: Script;
  /** Edited b-roll cues. */
  cues?: Cue[];
  /** Option edits (captionStyle / captionColor / videoProvider / videoResolution / renderQuality). */
  options?: Partial<PipelineOptions>;
  /** Non-destructive visual trims for generated clips. Does not re-run animation. */
  clipTrims?: { id: string; trimStartSec?: number; trimEndSec?: number }[];
}

function cleanTrim(value: unknown): number {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("clip trim values must be non-negative numbers");
  }
  return Math.round(value * 10) / 10;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  if (body.options) {
    try {
      validateOptions(body.options);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
    }
  }

  // Refuse edits while a run streams — they'd clobber its in-flight saves.
  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — try again when it finishes.", { status: 409 });
  }

  // Serialize all writers to this project so open→mutate→save can't interleave.
  return withProjectLock(safe, async () => {
    // Project.load never touches config/options — the persisted state is the truth.
    const project = await Project.load(root, safe);
    if (!project) return new Response("not found", { status: 404 });
    const s = project.state;

    const toClear = new Set<StageName>();
    const add = (stages: readonly StageName[]) => stages.forEach((x) => toClear.add(x));
    // Per-turn speech invalidation (cheap path): collect turn indices whose audio
    // must be re-bought instead of nuking the whole audio dir.
    const speechTurns = new Set<number>();
    const turnsOfHost = (hostId: string): number[] =>
      (s.script?.turns ?? []).filter((t) => t.hostId === hostId).map((t) => t.index);

    // ── Config (topic/style/turns/aspect/language) ──
    if (body.config) {
      const c = s.config;
      const n = body.config;
      if (n.aspectRatio !== undefined && n.aspectRatio !== c.aspectRatio) add(INVALIDATION.aspectRatio);
      if (
        (n.topic !== undefined && n.topic !== c.topic) ||
        (n.styleNote !== undefined && n.styleNote !== c.styleNote) ||
        (n.targetTurns !== undefined && n.targetTurns !== c.targetTurns) ||
        (n.maxWordsPerTurn !== undefined && n.maxWordsPerTurn !== c.maxWordsPerTurn) ||
        (n.language !== undefined && n.language !== c.language)
      ) {
        add(INVALIDATION.topic);
      }
      Object.assign(s.config, n);
    }

    // ── Hosts (voice/model → that host's turns; name/side → identity; persona → script) ──
    if (body.hosts) {
      const prev = s.config.hosts;
      body.hosts.forEach((h, i) => {
        const old = prev[i];
        if (!old) {
          add(INVALIDATION.hostIdentity);
          add(INVALIDATION.hostVoice);
          return;
        }
        // A voice-affecting change re-buys ONLY this host's turns (per-turn
        // speech invalidation), not the whole episode.
        if (
          h.voice !== old.voice ||
          h.model !== old.model ||
          h.defaultStability !== old.defaultStability ||
          h.defaultStyle !== old.defaultStyle
        ) {
          const turns = turnsOfHost(old.id);
          if (turns.length && s.speech) turns.forEach((t) => speechTurns.add(t));
          else add(INVALIDATION.hostVoice);
        }
        if (h.name !== old.name) add(INVALIDATION.captions);
        if (h.side !== old.side || h.appearance !== old.appearance || h.avatarKey !== old.avatarKey)
          add(INVALIDATION.hostIdentity);
        // Flip is baked into the animator's base avatar frame, so generated clips must be re-animated.
        if (h.flip !== old.flip) add(INVALIDATION.flip);
        // Absent persona means "not provided by this client", never "cleared".
        if (h.persona !== undefined && h.persona !== old.persona) add(INVALIDATION.topic);
      });
      s.config.hosts = body.hosts.slice(0, 2).map((h, i) => ({
        ...h,
        persona: h.persona ?? prev[i]?.persona,
      })) as [Host, Host];
      await syncRosterAvatarUploads(project);
    }

    // ── Script (manual edit) — re-index turns, re-derive speaker from hostId.
    //    Diff against the old turns: only CHANGED turns' audio is invalidated, so
    //    a one-word edit re-buys one turn, not the episode. ──
    if (body.script) {
      const speakerByHost = new Map(s.config.hosts.map((h) => [h.id, h.speaker]));
      const turns = body.script.turns
        .filter((t) => t.text?.trim())
        .map((t, i) => ({
          ...t,
          index: i,
          text: t.text.trim(),
          speaker: speakerByHost.get(t.hostId) ?? t.speaker,
        }));
      const old = s.script?.turns ?? [];
      if (old.length) {
        // Positional per-turn diff — valid even while the speech artifact is
        // already invalidated (mid re-voice): the per-turn audio sidecars and
        // clips on disk are keyed by index, and clearSpeechTurns/runSpeech
        // clear exactly the changed ones. Falling back to a full
        // INVALIDATION.script here would delete every clip for a one-line edit.
        const max = Math.max(turns.length, old.length);
        for (let i = 0; i < max; i++) {
          const a = old[i];
          const b = turns[i];
          if (!a || !b || a.text !== b.text || a.hostId !== b.hostId) speechTurns.add(i);
        }
      } else {
        add(INVALIDATION.script);
      }
      s.script = { ...body.script, turns };
      project.markDone("script");
    }

    // ── B-roll cues (edited list) ──
    if (body.cues) {
      s.broll = { cues: body.cues };
      project.markDone("broll");
      add(INVALIDATION.broll);
    }

    // ── Options (captions / video provider / resolution) ──
    if (body.options) {
      const o = s.options;
      const captiony = (["captionStyle", "captionColor"] as const).some(
        (k) => body.options![k] !== undefined && body.options![k] !== o[k],
      );
      const providerChanged = body.options.videoProvider !== undefined && body.options.videoProvider !== o.videoProvider;
      const resolutionChanged =
        body.options.videoResolution !== undefined && body.options.videoResolution !== o.videoResolution;
      s.options = mergeOptions({ ...o, ...body.options });
      if (captiony) add(INVALIDATION.captions);
      if (providerChanged) add(INVALIDATION.videoProvider);
      if (resolutionChanged) add(INVALIDATION.videoResolution);
    }

    // ── Clip trims (visual-only edit) ──
    if (body.clipTrims?.length) {
      if (!s.clips) return new Response("clips have not been generated yet", { status: 409 });
      const byId = new Map(s.clips.clips.map((clip) => [clip.id, clip]));
      for (const patch of body.clipTrims) {
        if (typeof patch.id !== "string" || !patch.id.trim()) {
          return new Response("clip trim id is required", { status: 400 });
        }
        const clip = byId.get(patch.id);
        if (!clip) return new Response(`unknown clip id: ${patch.id}`, { status: 404 });
        let trimStartSec: number;
        let trimEndSec: number;
        try {
          trimStartSec = cleanTrim(patch.trimStartSec);
          trimEndSec = cleanTrim(patch.trimEndSec);
        } catch (err) {
          return new Response(err instanceof Error ? err.message : String(err), { status: 400 });
        }
        const maxTotal = Math.max(0, clip.durationSec - 0.2);
        if (trimStartSec + trimEndSec > maxTotal) {
          return new Response(`clip trim exceeds usable duration for ${clip.id}`, { status: 400 });
        }
        const nextStart = trimStartSec > 0 ? trimStartSec : undefined;
        const nextEnd = trimEndSec > 0 ? trimEndSec : undefined;
        if (clip.trimStartSec !== nextStart || clip.trimEndSec !== nextEnd) {
          clip.trimStartSec = nextStart;
          clip.trimEndSec = nextEnd;
          add(INVALIDATION.clipTrim);
        }
      }
    }

    // Never clear an artifact we just set explicitly in this same request.
    if (body.script) toClear.delete("script");
    if (body.cues) toClear.delete("broll");

    // Per-turn speech invalidation (unless a broader clear already covers speech).
    if (speechTurns.size && !toClear.has("speech")) {
      await clearSpeechTurns(project, [...speechTurns]);
      // Turn indices REMOVED from the script (a shrink) will never be
      // re-synthesized, so runSpeech's clear-on-resynth can't reach their clips —
      // drop those orphans now (files + state), or they linger forever, inflating
      // clip counts while never showing in the per-turn grid.
      const removed = [...speechTurns].filter((i) => i >= (s.script?.turns.length ?? 0));
      if (removed.length && s.clips) await clearTurnClips(project, removed);
    }

    const ordered = STAGE_NAMES.filter((n) => toClear.has(n));
    await clearStages(project, ordered);
    await project.save();

    return Response.json({
      ...projectSummary(s),
      cleared: ordered,
      clearedTurns: [...speechTurns],
    });
  });
}
