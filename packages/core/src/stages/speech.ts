import { synthesizeTurn, extForMediaType } from "../clients/speechbase";
import { clearStages, clearTurnClips } from "../editing";
import { fileExists, readJson, writeBytes, writeJson, remove, ensureDir } from "../util/fs";
import { retry } from "../util/retry";
import { probeDuration, normalizeTimestamps, padAudioTail, concatAudio, sliceAudio } from "../util/audio";
import { providerOf } from "../types";
import { compilePerformance, isAudioTagWord } from "../performance";
import { buildTurnRegions, planSegmentBoundaries, type SynthesizedTurn, type TurnSegment } from "./turn-timing";
import type { StageContext } from "./context";
import type { SpeechArtifact, ScriptTurn } from "../types";

const SYNTH_CONCURRENCY = 6;
/** Keep each LTX clip under the ~20s cap; long turns split into multiple segments. */
const MAX_SEGMENT_SEC = 18;

/** Per-turn sidecar persisted next to the audio so a failed/interrupted run
 *  resumes without re-buying completed turns. Reuse requires an exact match on
 *  everything baked into the audio files (host voice/model + text + the
 *  inter-turn pause). */
interface TurnSidecar {
  hostId: string;
  model: string;
  voice: string;
  text: string;
  /** The pause baked into this turn's last segment (options.gapMs at synth time). */
  gapMs: number;
  segments: TurnSegment[];
  words: SynthesizedTurn["words"];
}

/**
 * Synthesize each turn STANDALONE (with word timestamps), bake the inter-turn pause
 * into each file, feed those files directly to the animator, and concat them into a
 * derived master for playback/compose. No master-slicing — see ./turn-timing.ts.
 */
export async function runSpeech(ctx: StageContext): Promise<void> {
  const { project, env, reporter, signal } = ctx;
  const log = reporter.stage("speech");
  const { config, options, script } = project.state;

  if (!script) throw new Error("speech stage requires a script");

  if (project.state.speech && project.stageDone("speech")) {
    log.info("cached", { duration: project.state.speech.durationSec });
    return;
  }

  // All TTS routes through the Speechbase gateway — BYOK provider keys live in
  // your Speechbase account, not in this repo.
  if (!env.speechbaseApiKey) {
    throw new Error("SPEECHBASE_API_KEY is required (set it in .env.local — get one at speechbase.ai)");
  }

  const hostById = new Map(config.hosts.map((h) => [h.id, h]));
  const providers = [...new Set(config.hosts.map((h) => providerOf(h)))];
  const apiKey = env.speechbaseApiKey;
  const gapSec = (options.gapMs ?? 320) / 1000;
  const scriptTurns = script.turns;
  const lastIndex = Math.max(...scriptTurns.map((t) => t.index));

  log.info(
    `synthesizing ${scriptTurns.length} standalone turns via Speechbase · providers: ${providers.join(", ")}`,
  );
  await ensureDir(project.path("audio"));

  const sidecarPath = (index: number): string => project.path("audio", `turn-${index}.json`);

  /** Reuse a completed turn from a previous (failed/interrupted) run when its
   *  inputs are identical and every segment file survived. */
  async function fromSidecar(t: ScriptTurn): Promise<SynthesizedTurn | null> {
    const path = sidecarPath(t.index);
    if (!fileExists(path)) return null;
    const side = await readJson<TurnSidecar>(path).catch(() => null);
    const host = hostById.get(t.hostId);
    if (
      !side ||
      !host ||
      side.hostId !== t.hostId ||
      side.model !== host.model ||
      side.voice !== host.voice ||
      side.text !== t.text ||
      side.gapMs !== (options.gapMs ?? 320) ||
      !side.segments.length ||
      !side.segments.every((s) => fileExists(project.abs(s.audioPath)))
    ) {
      return null;
    }
    return { turnIndex: t.index, hostId: t.hostId, speaker: t.speaker, text: t.text, segments: side.segments, words: side.words };
  }

  // One turn: synth WITH timestamps → write raw → split into ≤MAX_SEGMENT_SEC segments
  // at word gaps (so no turn ever exceeds the LTX clip cap) → re-encode each to a uniform
  // mp3 (the turn's last segment carries the baked-in inter-turn pause).
  async function synthOne(t: ScriptTurn): Promise<SynthesizedTurn> {
    const cached = await fromSidecar(t);
    if (cached) {
      log.info(`turn ${t.index} · reused (unchanged audio)`);
      return cached;
    }
    resynthesized.push(t.index);

    const host = hostById.get(t.hostId)!;
    const { text, providerOptions } = compilePerformance(host, t);
    const opts = providerOptions ?? host.providerOptions;
    const out = await retry(
      () =>
        synthesizeTurn({
          model: host.model,
          voice: host.voice,
          text,
          ...(opts ? { providerOptions: opts } : {}),
          ...(apiKey ? { apiKey } : {}),
        }),
      { onRetry: (err, n) => log.warn(`turn ${t.index} synth failed (attempt ${n}) — retrying: ${err instanceof Error ? err.message : String(err)}`) },
    );

    const rawPath = project.path("audio", `turn-${t.index}.raw.${extForMediaType(out.mediaType)}`);
    const temps = [rawPath];
    try {
      await writeBytes(rawPath, out.audio);
      const rawDuration = await probeDuration(rawPath);

      // Drop audio-tag tokens (e.g. "[laughs]") so captions never show the direction;
      // guard ms-vs-seconds against THIS turn's own duration.
      const spoken = out.words.filter((w) => !isAudioTagWord(w.text));
      const words = normalizeTimestamps(spoken, rawDuration);
      if (words.length === 0) {
        log.warn(
          `turn ${t.index} returned NO word timestamps — captions and b-roll timing for this turn will fall back to the turn boundary`,
        );
      }

      const bounds = planSegmentBoundaries(words, rawDuration, MAX_SEGMENT_SEC);
      const isLastTurn = t.index === lastIndex;
      const segments: TurnSegment[] = [];
      for (let s = 0; s < bounds.length - 1; s++) {
        const pad = s === bounds.length - 2 && !isLastTurn ? gapSec : 0; // pause on the turn's last seg
        const segFinal = project.path("audio", `turn-${t.index}-${s}.mp3`);
        if (bounds.length === 2) {
          // whole turn is one segment — pad the raw directly (single re-encode).
          await padAudioTail(rawPath, segFinal, pad);
        } else {
          const segRaw = project.path("audio", `turn-${t.index}-${s}.raw.mp3`);
          temps.push(segRaw);
          await sliceAudio(rawPath, bounds[s]!, bounds[s + 1]!, segRaw);
          await padAudioTail(segRaw, segFinal, pad);
        }
        segments.push({ audioPath: project.rel(segFinal), durationSec: await probeDuration(segFinal) });
      }

      const total = segments.reduce((a, sg) => a + sg.durationSec, 0);
      log.info(`turn ${t.index} · ${host.name} · ${segments.length} seg · ${total.toFixed(1)}s · ${words.length} words`);
      const result: SynthesizedTurn = { turnIndex: t.index, hostId: t.hostId, speaker: t.speaker, text: t.text, segments, words };
      // Persist the sidecar as the turn completes — the unit of resume.
      await writeJson(sidecarPath(t.index), {
        hostId: t.hostId,
        model: host.model,
        voice: host.voice,
        text: t.text,
        gapMs: options.gapMs ?? 320,
        segments,
        words,
      } satisfies TurnSidecar);
      return result;
    } finally {
      for (const f of temps) await remove(f); // never strand raw temps, even on a mid-turn failure
    }
  }

  // Bounded-concurrency worker pool (results stay in turn order). On the first
  // failure, set `failed` so sibling workers stop firing more paid TTS calls.
  const synthd = new Array<SynthesizedTurn>(scriptTurns.length);
  const resynthesized: number[] = [];
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    for (let i = next++; i < scriptTurns.length && !failed && !signal?.aborted; i = next++) {
      try {
        synthd[i] = await synthOne(scriptTurns[i]!);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SYNTH_CONCURRENCY, scriptTurns.length) }, () => worker()));
  if (signal?.aborted) throw new Error("run cancelled");

  // Place turns on the absolute timeline (cumulative offsets — pure + tested).
  const { regions } = buildTurnRegions(synthd);

  // Derived master = pure concat of every segment in order (pauses already baked in).
  const masterPath = project.path("audio", "conversation.mp3");
  const segPaths = regions.flatMap((r) => r.segments.map((s) => project.abs(s.audioPath)));
  await concatAudio(segPaths, masterPath);
  const durationSec = await probeDuration(masterPath);

  const words = regions.flatMap((r) => r.words);
  await writeJson(project.path("audio", "alignment.json"), words);

  // Audio changed for these turns (TTS is nondeterministic — durations shift on
  // every synth), so anything built on the OLD audio for them is stale. Clear
  // exactly that: the re-synthesized turns' clips (unchanged turns keep their
  // paid clips — they animate a byte-identical audio file), plus the timeline
  // consumers (b-roll cues, compose, render). Pure sidecar-resume runs
  // (resynthesized = 0) invalidate nothing.
  if (resynthesized.length > 0) {
    if (project.state.clips) await clearTurnClips(project, resynthesized);
    else await clearStages(project, ["compose", "render"]);
    await clearStages(project, ["broll"]);
  }

  const artifact: SpeechArtifact = {
    audioPath: project.rel(masterPath),
    mediaType: "audio/mpeg",
    durationSec,
    words,
    turns: regions,
    gapMs: options.gapMs,
  };
  project.state.speech = artifact;
  project.markDone("speech", {
    durationSec,
    words: words.length,
    turns: regions.length,
    providers,
  });
  await project.save();

  const wordless = regions.filter((r) => r.words.length === 0).length;
  if (wordless > 0) log.warn(`${wordless} turn(s) have no word timestamps — captions for them will be empty`);
  const reused = scriptTurns.length - resynthesized.length;
  log.success(
    `${durationSec.toFixed(1)}s · ${words.length} words · ${regions.length} standalone turns` +
      (reused > 0 ? ` (${reused} reused, ${resynthesized.length} synthesized)` : ""),
  );
}
