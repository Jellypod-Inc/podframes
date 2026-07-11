import { basename, extname } from "node:path";
import { buildComposition, type ClipView } from "../compose/builder";
import { buildCaptionGroups } from "../compose/captions";
import { buildTrimmedTimeline, mapCuesToTrimmedTimeline } from "../compose/trim";
import { CANVAS, captionMaxWords } from "../shared";
import { copyFonts } from "../compose/fonts";
import { ensureDir, linkInto, writeText } from "../util/fs";
import { concatAudio, probeDuration, sliceAudio } from "../util/audio";
import { trimVideo } from "../util/video";
import type { StageContext } from "./context";
import type { Cue } from "../types";

export async function runCompose(ctx: StageContext): Promise<void> {
  const { project, reporter } = ctx;
  const log = reporter.stage("compose");
  const { config, options, script, speech, clips, broll } = project.state;

  if (!script || !speech || !clips) throw new Error("compose stage requires script, speech, clips");

  const aspect = config.aspectRatio ?? "16:9";
  const { width, height } = CANVAS[aspect];

  const compDir = project.path("composition");
  const mediaDir = `${compDir}/media`;
  await ensureDir(`${mediaDir}/clips`);
  await ensureDir(`${mediaDir}/broll`);
  await ensureDir(`${mediaDir}/avatars`);

  log.info("linking media into the composition");

  const timeline = buildTrimmedTimeline(speech.turns, clips.clips);
  const segmentByClip = new Map(
    timeline.segments.map((seg) => [`${seg.turnIndex}:${seg.segIndex}`, seg]),
  );

  // Clips → media/clips (hardlinked — recompose happens after every caption
  // tweak; byte-copying hundreds of MB of clips each time is pure overhead).
  const clipViews: ClipView[] = [];
  for (const clip of clips.clips) {
    const segment = clip.turnIndex != null ? segmentByClip.get(`${clip.turnIndex}:${clip.segIndex ?? 0}`) : undefined;
    const trimStartSec = segment?.trimStartSec ?? 0;
    const trimEndSec = segment?.trimEndSec ?? 0;
    const dest = trimStartSec || trimEndSec
      ? await trimVideo(project.abs(clip.path), `${mediaDir}/clips/${clip.id}.mp4`, trimStartSec, trimEndSec, clip.durationSec)
      : await linkInto(project.abs(clip.path), `${mediaDir}/clips`, `${clip.id}.mp4`);
    clipViews.push({
      id: clip.id,
      role: clip.role,
      ...(clip.hostId ? { hostId: clip.hostId } : {}),
      ...(clip.turnIndex != null ? { turnIndex: clip.turnIndex } : {}),
      ...(clip.segIndex != null ? { segIndex: clip.segIndex } : {}),
      src: `media/clips/${basename(dest)}`,
      durationSec: segment?.durationSec ?? clip.durationSec,
    });
  }

  // Audio → media/audio.<ext>
  let audioSrc: string;
  let audioDurationSec = speech.durationSec;
  if (timeline.hasTrim) {
    await ensureDir(`${mediaDir}/audio-segments`);
    const inputs: string[] = [];
    for (const segment of timeline.segments) {
      if (segment.trimStartSec || segment.trimEndSec) {
        const dest = `${mediaDir}/audio-segments/turn-${segment.turnIndex}-${segment.segIndex}.mp3`;
        await sliceAudio(project.abs(segment.audioPath), segment.sourceStartSec, segment.sourceEndSec, dest);
        inputs.push(dest);
      } else {
        inputs.push(project.abs(segment.audioPath));
      }
    }
    const audioPath = `${mediaDir}/audio.mp3`;
    await concatAudio(inputs, audioPath);
    audioDurationSec = await probeDuration(audioPath);
    audioSrc = "media/audio.mp3";
  } else {
    const audioExt = extname(project.abs(speech.audioPath)) || ".mp3";
    await linkInto(project.abs(speech.audioPath), mediaDir, `audio${audioExt}`);
    audioSrc = `media/audio${audioExt}`;
  }

  // Brand fonts → media/fonts (the composition renders in headless Chrome, which
  // has no project fonts installed — see compose/fonts.ts).
  const fonts = await copyFonts(`${mediaDir}/fonts`);

  // Cues → all four types render (b-roll cards, stat cards, quotes, lower-thirds
  // are the HyperFrames component visuals); image cues get their file linked in.
  const cues: Array<Cue & { image?: string }> = [];
  for (const cue of broll?.cues ?? []) {
    let image: string | undefined;
    if (cue.imagePath) {
      const dest = await linkInto(project.abs(cue.imagePath), `${mediaDir}/broll`, `${cue.id}.png`);
      image = `media/broll/${basename(dest)}`;
    }
    cues.push({ ...cue, ...(image ? { image } : {}) });
  }
  const timedCues = timeline.hasTrim ? mapCuesToTrimmedTimeline(cues, timeline.segments, timeline.durationSec) : cues;

  // Host base avatars → media/avatars (poster/fallback behind generated clips).
  const hostAvatars: Record<string, string> = {};
  if (project.state.stills) {
    for (const [hostId, avatar] of Object.entries(project.state.stills.hosts)) {
      const dest = await linkInto(project.abs(avatar.imagePath), `${mediaDir}/avatars`, `${hostId}.png`);
      hostAvatars[hostId] = `media/avatars/${basename(dest)}`;
    }
  }

  // Phrase length is a per-style layout choice (slam throws 2 words at a time,
  // boxed a full subtitle line) — see CAPTION_STYLE_PRESETS.maxWords.
  const captions = buildCaptionGroups(timeline.turns, captionMaxWords(options.captionStyle));

  // Trim trailing silence: end the piece shortly after the last spoken word.
  // A turn with no word timestamps (a real Speechbase gateway path) contributes
  // its region END — otherwise a word-less final turn would truncate the video.
  const lastWordEnd = Math.max(
    0,
    ...timeline.turns.map((t) => (t.words.length ? t.words[t.words.length - 1]!.end : t.end)),
    ...(captions.length ? [captions[captions.length - 1]!.end] : []),
  );
  const durationSec = Math.min(audioDurationSec, lastWordEnd + 0.2);

  log.info(
    `assembling ${width}x${height} · ${clipViews.length} clips · ${captions.length} caption groups · ${timedCues.length} cues · ${durationSec.toFixed(1)}s`,
  );

  const html = buildComposition({
    width,
    height,
    fps: options.fps,
    title: script.title,
    hook: script.hook,
    topic: config.topic,
    durationSec,
    audioSrc,
    fonts,
    hosts: config.hosts,
    clips: clipViews,
    turns: timeline.turns,
    captions,
    cues: timedCues,
    hostAvatars,
    visualTreatment: options.visualTreatment,
    captionStyle: options.captionStyle,
    captionColor: options.captionColor,
  });

  const indexPath = `${compDir}/index.html`;
  await writeText(indexPath, html);

  project.state.composition = {
    dir: project.rel(compDir),
    indexPath: project.rel(indexPath),
    width,
    height,
    durationSec,
  };
  project.markDone("compose", { width, height, captions: captions.length, cues: cues.length });
  await project.save();
  log.success(`composition written → ${project.rel(indexPath)}`);
}
