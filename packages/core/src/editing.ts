import type { Project } from "./project";
import type { ProjectState, StageName } from "./types";
import { remove } from "./util/fs";
import { join } from "node:path";

type ArtifactKey = "script" | "speech" | "stills" | "clips" | "broll" | "composition" | "output";

/**
 * For each stage: which {@link ProjectState} artifact it produces, and the on-disk
 * files/dirs (project-relative) it owns. Invalidating a stage must clear BOTH —
 * the stages reuse cached files via `fileExists()` (stills reuse generated avatar files,
 * video reuses `turn-N.mp4`, broll reuses `cue-N.png`), so nulling the state key
 * alone is NOT enough to force regeneration; the files must be deleted too.
 */
export const STAGE_ARTIFACTS: Record<
  StageName,
  { key: ArtifactKey; files: (state: ProjectState) => string[] }
> = {
  script: { key: "script", files: () => ["script.json"] },
  speech: { key: "speech", files: () => ["audio"] },
  stills: {
    key: "stills",
    // Generated avatar images only — uploaded `<id>-base.png` references are preserved.
    files: (s) => [
      "stills/two-shot.png",
      ...s.config.hosts.flatMap((h) => [
        `stills/${h.id}-speaking.png`,
        `stills/${h.id}-idle.png`,
        `stills/${h.id}-avatar.png`,
      ]),
    ],
  },
  video: { key: "clips", files: () => ["clips"] },
  broll: { key: "broll", files: () => ["broll"] },
  compose: { key: "composition", files: () => ["composition"] },
  render: { key: "output", files: () => ["output.mp4", "output.raw.mp4"] },
};

/**
 * Invalidate stages so the next {@link generate} run regenerates them: null the
 * state artifact, reset the stage status to `pending`, and DELETE the owned files.
 * Does NOT save — the caller saves once after applying all edits.
 */
export async function clearStages(project: Project, names: StageName[]): Promise<void> {
  for (const name of names) {
    const spec = STAGE_ARTIFACTS[name];
    project.state[spec.key] = undefined;
    project.state.stages[name] = { status: "pending" };
    for (const rel of spec.files(project.state)) {
      await remove(project.abs(rel));
    }
  }
}

/**
 * Invalidate ONLY specific turns' lip-sync clips (not the whole video stage), so
 * editing/re-rolling one turn re-animates just that turn while clean turn-N.mp4
 * files are reused. Deletes those clips, drops them from state.clips, sets the
 * video stage back to pending, and recomposes. Used for audio-preserving edits
 * (gesture, face, manual re-roll) — a text/voice/delivery edit changes the audio
 * and must invalidate the whole video stage instead. Does NOT save.
 */
export async function clearTurnClips(project: Project, turnIndices: number[]): Promise<void> {
  const set = new Set(turnIndices);
  const existing = project.state.clips?.clips ?? [];
  // Remove ALL of each turn's segment clips (turn-N-segK.mp4) by their real path; the
  // turn's standalone audio (audio/turn-N-*.mp3) is preserved, since this path is for
  // audio-preserving edits (gesture/face/re-roll).
  for (const c of existing) {
    if (c.turnIndex != null && set.has(c.turnIndex)) await remove(project.abs(c.path));
  }
  if (project.state.clips) {
    project.state.clips.clips = existing.filter((c) => c.turnIndex == null || !set.has(c.turnIndex));
  }
  // Force the video stage to re-run; its per-clip fileExists cache rebuilds only the
  // deleted clips and reuses the rest. Downstream must recompose + re-render.
  project.state.stages.video = { status: "pending" };
  await clearStages(project, ["compose", "render"]);
}

/**
 * Invalidate ONLY specific turns' speech (and their clips): delete those turns'
 * audio files + sidecars and the derived master, keep every other turn's audio
 * intact, and set the speech stage back to pending. The speech stage's sidecar
 * resume (stages/speech.ts) then re-buys ONLY these turns; unchanged turns —
 * and their already-paid lip-sync clips — are reused byte-identically.
 *
 * This is the per-turn edit economics: a one-word script edit or a single-host
 * voice change costs one turn, not the episode. Does NOT save.
 */
export async function clearSpeechTurns(project: Project, turnIndices: number[]): Promise<void> {
  const audioDir = project.abs("audio");
  for (const i of turnIndices) {
    // turn-N.json (sidecar) + every turn-N-*.mp3 segment. Segment count is
    // unknown after a text change, so sweep a generous fixed range.
    await remove(join(audioDir, `turn-${i}.json`));
    for (let s = 0; s < 12; s++) await remove(join(audioDir, `turn-${i}-${s}.mp3`));
  }
  // The derived master + alignment are rebuilt from the per-turn files.
  await remove(join(audioDir, "conversation.mp3"));
  await remove(join(audioDir, "alignment.json"));
  project.state.speech = undefined;
  project.state.stages.speech = { status: "pending" };
  // Downstream: the re-synth path in runSpeech clears the affected clips,
  // b-roll, compose, and render once it knows which turns actually changed.
}

// The invalidation graph itself is pure data shared with the browser (which
// uses it to warn before destructive edits) — it lives in shared.ts.
export { INVALIDATION } from "./shared";
