import { audioToVideo as audioToVideoFal } from "../clients/fal";
import { audioToVideo as audioToVideoReplicate } from "../clients/replicate";
import { probeDuration } from "../util/audio";
import { run } from "../util/proc";
import { retry } from "../util/retry";
import { ensureDir, fileExists } from "../util/fs";
import type { StageContext } from "./context";
import type { ClipAsset, Host } from "../types";

// LTX-2.3 default negatives (motionless/static/blurry) + our talking-head guards.
// The camera-motion terms matter most: audio-to-video models love a slow push-in
// on the face, which reads as janky when clips cross-cut every few seconds.
const NEGATIVE =
  "motionless frame, static, blurry details, frozen face, closed mouth while audio plays, not speaking, " +
  "mouth not moving, expressionless, listening passively, looking away from camera, subtitles, captions, " +
  "on-screen text, watermark, logo, warped face, morphing identity, extra fingers, distorted hands, " +
  "jump cut, camera zoom, zooming in, push-in, dolly in, pull out, crop in, camera pan, camera drift, " +
  "camera shake, fast camera movement, changing framing";

export async function runVideo(ctx: StageContext): Promise<void> {
  const provider = ctx.project.state.options.videoProvider;
  if (provider === "fal-ltx") return runVideoFal(ctx);
  if (provider === "replicate-p-video") return runVideoReplicate(ctx);
  throw new Error(
    `unknown videoProvider "${provider as string}" — supported: fal-ltx, replicate-p-video`,
  );
}

// ── Per-turn audio-to-video (shared by fal-ltx and replicate-p-video): one ────
// lip-synced clip per turn, driven by that turn's audio. Only the actual
// generate call differs between providers; everything else — base-still prep
// (incl. baked flip), turn→segment flattening, concurrency pool, clip assembly —
// is identical, so it lives here once.

// This is a PODCAST: the input image already defines identity, pose, setting,
// and framing. Keep this prompt deliberately small so the animator doesn't get
// invited to invent camera motion or a performance.
function talkingHeadPrompt(h: Host): string {
  return (
    `${h.name} is the avatar in the input image. The avatar talks to camera with accurate lip-sync. ` +
    "Keep the input image framing, pose, and background unchanged except for natural mouth movement."
  );
}

type PerTurnProvider = "fal-ltx" | "replicate-p-video";

type AnimateUnit = (args: {
  imagePath: string;
  audioPath: string;
  prompt: string;
  seed: number;
  outputPath: string;
}) => Promise<void>;

async function runPerTurnVideo(ctx: StageContext, provider: PerTurnProvider, animate: AnimateUnit): Promise<void> {
  const { project, reporter, signal } = ctx;
  const log = reporter.stage("video");
  const { config, options, stills, script, speech } = project.state;

  if (!stills || !script || !speech) throw new Error(`${provider} video requires stills, script, and speech`);
  if (project.state.clips && project.stageDone("video")) {
    log.info("cached", { clips: project.state.clips.clips.length });
    return;
  }

  const aspect = config.aspectRatio ?? "16:9";
  const [genW, genH] =
    aspect === "9:16"
      ? options.videoResolution === "1080p"
        ? [1080, 1920]
        : [720, 1280]
      : options.videoResolution === "1080p"
        ? [1920, 1080]
        : [1280, 720];

  const hostById = new Map(config.hosts.map((h) => [h.id, h]));

  // Resize each host's base avatar image to the generation size once; reuse for every turn.
  await ensureDir(project.path("clips"));
  const baseAvatar = new Map<string, string>();
  for (const h of config.hosts) {
    const out = project.path("clips", `_base-${h.id}.png`);
    if (!fileExists(out)) {
      // ffmpeg 8 needs -frames:v 1 -update 1 to write a single image to a fixed filename.
      // Aspect-preserving cover-crop (never a plain stretch — uploaded reference photos
      // are usually portrait and would otherwise distort before animation).
      // Mirror the base avatar here (hflip) when the host is flipped, so the animator generates the
      // clip in the exact target orientation — not a compose-time CSS mirror after the fact.
      await run("ffmpeg", [
        "-y",
        "-i",
        project.abs(stills.hosts[h.id]!.imagePath),
        "-vf",
        `scale=${genW}:${genH}:force_original_aspect_ratio=increase,crop=${genW}:${genH}${h.flip ? ",hflip" : ""}`,
        "-frames:v",
        "1",
        "-update",
        "1",
        out,
      ]);
    }
    baseAvatar.set(h.id, out);
  }

  // ── One standalone clip per turn ──
  // Each turn was synthesized as its OWN audio file (audio/turn-N.mp3) with the
  // inter-turn pause baked in, so we feed that file DIRECTLY to the animator — no slicing
  // of a master, no boundary guesses, no inherited silence at the head. The clip's length
  // is exactly its turn's audio, so the base track tiles 1:1 with zero frozen frames.
  // Flatten turns → animation units (one clip per segment; a long turn has >1).
  const units = speech.turns.flatMap((region) =>
    region.segments.map((seg, segIndex) => ({ region, seg, segIndex })),
  );

  // The studio's checkboxes: constrain PAID animation to the selected turns.
  // Everything else keeps its existing clip; the stage is only "done" when
  // every turn is covered, so a later full run picks up whatever remains.
  const targetSet = ctx.onlyTurns?.length ? new Set(ctx.onlyTurns) : null;
  const work = targetSet ? units.filter((u) => targetSet.has(u.region.turnIndex)) : units;
  if (targetSet && work.length === 0) throw new Error("onlyTurns matched no turns in this script");

  const concurrency = Math.max(1, Math.min(options.videoConcurrency ?? 4, Math.max(1, work.length)));
  const modelId = provider === "fal-ltx" ? options.falVideoModel : options.replicateVideoModel;
  log.info(
    `animating ${work.length} of ${units.length} clips (${speech.turns.length} turns) with ${modelId} · ${genW}x${genH} · up to ${concurrency} in parallel (lip-synced)`,
  );

  // One clip asset, read from the file on disk (used for freshly-rendered AND
  // previously-existing clips, so a subset run never drops the others from state).
  async function assetFor(u: (typeof units)[number]): Promise<ClipAsset> {
    const { region, seg, segIndex } = u;
    const h = hostById.get(region.hostId)!;
    const id = `turn-${region.turnIndex}-${segIndex}`;
    const clipPath = project.path("clips", `${id}.mp4`);
    const durationSec = await probeDuration(clipPath);
    if (seg.durationSec - durationSec > 0.15) {
      log.warn(
        `clip ${id} is ${durationSec.toFixed(1)}s but its audio is ${seg.durationSec.toFixed(1)}s — the tail will show the base avatar, not freeze`,
      );
    }
    return {
      id,
      role: "avatar",
      hostId: h.id,
      turnIndex: region.turnIndex,
      segIndex,
      path: project.rel(clipPath),
      durationSec,
      sourceImage: project.rel(baseAvatar.get(h.id)!),
    };
  }

  async function renderUnit(u: (typeof units)[number]): Promise<ClipAsset> {
    const { region, seg, segIndex } = u;
    const h = hostById.get(region.hostId)!;
    const id = `turn-${region.turnIndex}-${segIndex}`;
    const clipPath = project.path("clips", `${id}.mp4`);
    const segLen = Math.max(0.4, seg.durationSec);
    if (!fileExists(clipPath)) {
      log.clip(`${provider} → ${id} · ${h.name} · ${segLen.toFixed(1)}s`, {
        turnIndex: region.turnIndex,
        segIndex,
        hostId: h.id,
        status: "rendering",
        total: units.length,
      });
      await retry(
        () =>
          animate({
            imagePath: baseAvatar.get(h.id)!,
            audioPath: project.abs(seg.audioPath),
            prompt: talkingHeadPrompt(h),
            seed: 1000 + region.turnIndex * 10 + segIndex,
            outputPath: clipPath,
          }),
        {
          attempts: 2,
          onRetry: (err) =>
            log.warn(`${id} failed — retrying once: ${err instanceof Error ? err.message : String(err)}`),
        },
      );
    }
    const asset = await assetFor(u);
    // Typed clip event so the client can play this clip straight off the SSE stream (no
    // DTO/route round-trip): the pane builds /api/media/{slug}/{path} and shows it live.
    log.clip(`clip ${id} ready`, {
      turnIndex: region.turnIndex,
      segIndex,
      hostId: h.id,
      status: "done",
      path: asset.path,
      durationSec: asset.durationSec,
      total: units.length,
    });
    return asset;
  }

  // Concurrency-limited worker pool — render up to `concurrency` clips at once to cut
  // wall-clock without tripping provider rate limits. Results stay in segment order.
  // On the first failure `failed` stops sibling workers from claiming NEW paid units
  // (mirroring the speech pool), and everyone finishes their current unit before the
  // stage rethrows — no orphan writer ever outlives the run.
  const rendered: ClipAsset[] = new Array<ClipAsset>(work.length);
  let done = 0;
  let next = 0;
  let failed = false;
  let firstErr: unknown;
  // Serialize incremental saves so partial progress survives a failure — the UI
  // then shows exactly which clips exist instead of "not generated" across the board.
  let saveChain: Promise<void> = Promise.resolve();
  const persistPartial = (): void => {
    const fresh = rendered.filter(Boolean);
    const freshIds = new Set(fresh.map((c) => c.id));
    const kept = (project.state.clips?.clips ?? []).filter((c) => !freshIds.has(c.id));
    project.state.clips = { clips: [...kept, ...fresh] };
    saveChain = saveChain.then(() => project.save()).catch(() => {});
  };
  async function worker(): Promise<void> {
    for (let i = next++; i < work.length && !failed && !signal?.aborted; i = next++) {
      try {
        rendered[i] = await renderUnit(work[i]!);
      } catch (err) {
        failed = true;
        firstErr ??= err;
        return;
      }
      done++;
      persistPartial();
      log.progress(done / work.length, `${done}/${work.length} clips`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await saveChain;
  if (firstErr) throw firstErr;
  if (signal?.aborted) throw new Error("run cancelled");

  // Assemble the FULL clip list from what's actually on disk — freshly-rendered
  // AND pre-existing clips alike. Done means done: the stage only reports
  // complete when EVERY turn segment has a clip, so a checkbox-subset run leaves
  // it pending and a later full run animates just the remainder.
  const clips: ClipAsset[] = [];
  let missing = 0;
  for (const u of units) {
    const clipPath = project.path("clips", `turn-${u.region.turnIndex}-${u.segIndex}.mp4`);
    if (fileExists(clipPath)) clips.push(await assetFor(u));
    else missing++;
  }
  project.state.clips = { clips };
  if (missing === 0) {
    project.markDone("video", { clips: clips.length, provider });
  } else {
    project.state.stages.video = { status: "pending" };
  }
  await project.save();
  log.success(
    missing === 0
      ? `${clips.length} lip-synced clips`
      : `${clips.length}/${units.length} clips ready · ${missing} turn segment(s) not yet animated`,
  );
}

async function runVideoFal(ctx: StageContext): Promise<void> {
  const { env } = ctx;
  const { options } = ctx.project.state;
  if (!env.falApiKey) throw new Error("FAL_API_KEY is required for fal-ltx video (set it in .env.local)");
  const falApiKey = env.falApiKey;

  await runPerTurnVideo(ctx, "fal-ltx", async ({ imagePath, audioPath, prompt, seed, outputPath }) => {
    await audioToVideoFal({
      apiKey: falApiKey,
      model: options.falVideoModel,
      imagePath,
      audioPath,
      prompt,
      resolution: "auto",
      // 0.85: hold the input framing for the whole clip — the podcast shot must
      // not drift or push in (the client also disables fal's prompt expansion).
      imageStrength: 0.85,
      videoQuality: options.renderQuality === "draft" ? "medium" : "high",
      negativePrompt: NEGATIVE,
      seed,
      // Embed the driving audio in the clip itself, so previews in the studio are
      // audible. The final composition mutes every clip and plays the mixed master
      // track, so this never double-plays.
      includeAudio: true,
      outputPath,
      onLog: () => {},
    });
  });
}

async function runVideoReplicate(ctx: StageContext): Promise<void> {
  const { env } = ctx;
  const { options } = ctx.project.state;
  if (!env.replicateApiKey) {
    throw new Error("REPLICATE_API_KEY is required for replicate-p-video (set it in .env.local)");
  }
  const replicateApiKey = env.replicateApiKey;

  await runPerTurnVideo(ctx, "replicate-p-video", async ({ imagePath, audioPath, prompt, seed, outputPath }) => {
    await audioToVideoReplicate({
      apiKey: replicateApiKey,
      model: options.replicateVideoModel,
      imagePath,
      audioPath,
      prompt,
      resolution: options.videoResolution,
      fps: options.fps,
      draft: options.renderQuality === "draft",
      seed,
      outputPath,
      onLog: () => {},
    });
  });
}
