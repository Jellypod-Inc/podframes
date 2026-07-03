import { Type } from "../clients/gemini";
import { contentHash, fileExists } from "../util/fs";
import type { StageContext } from "./context";
import type { Cue, CueType } from "../types";

interface RawCue {
  start: number;
  end: number;
  type: CueType;
  title?: string;
  subtitle?: string;
  figure?: string;
  imagePrompt?: string;
  turnIndex?: number;
}

const cueSchema = (types: CueType[]) => ({
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      start: { type: Type.NUMBER, description: "start time in seconds" },
      end: { type: Type.NUMBER, description: "end time in seconds (2.5–5s after start)" },
      type: { type: Type.STRING, enum: types },
      title: { type: Type.STRING, description: "headline / lower-third / quote text" },
      subtitle: { type: Type.STRING, description: "short supporting line (optional)" },
      figure: { type: Type.STRING, description: "the big number/figure, for type=stat" },
      imagePrompt: {
        type: Type.STRING,
        description: "for type=broll: a vivid image description (NO text in the image)",
      },
      turnIndex: { type: Type.NUMBER, description: "which turn this supports" },
    },
    required: ["start", "end", "type"],
    propertyOrdering: ["start", "end", "type", "title", "subtitle", "figure", "imagePrompt", "turnIndex"],
  },
});

/** Content-addressed image path: identical prompts reuse the file for free,
 *  changed prompts regenerate automatically — stale reuse is impossible. */
export function brollImagePath(cue: Pick<Cue, "id" | "imagePrompt">): string {
  return `broll/${cue.id}-${contentHash(cue.imagePrompt ?? "", 8)}.png`;
}

export async function runBroll(ctx: StageContext): Promise<void> {
  const { project, gemini, reporter, signal } = ctx;
  const log = reporter.stage("broll");
  const { config, options, speech, script } = project.state;

  if (!speech || !script) throw new Error("broll stage requires speech + script");

  if (project.state.broll && project.stageDone("broll")) {
    log.info("cached", { cues: project.state.broll.cues.length });
    return;
  }

  const cueTypes: CueType[] = ["broll", "lower-third", "stat", "quote"];

  // Sparse by design: graphics earn their place at ~1–2 PER MINUTE, never
  // wall-to-wall. maxCues stays the user's hard ceiling on top.
  const budget = Math.max(1, Math.min(options.maxCues, Math.ceil((speech.durationSec / 60) * 1.5)));

  // Resume: if a previous run planned cues but failed mid-image-generation, reuse
  // the SAME plan instead of re-asking Gemini (a fresh, different cue list would
  // orphan the images already paid for).
  let cleaned = project.state.broll?.cues;
  if (!cleaned) {
    const transcript = speech.turns
      .map((t) => `[${t.start.toFixed(1)}-${t.end.toFixed(1)}s] (turn ${t.turnIndex}) ${t.text}`)
      .join("\n");

    const system =
      "You are a sharp video editor packaging a podcast. You decide where on-screen graphics earn " +
      "their place: b-roll for a concrete thing/place/example, a stat card for a memorable number, a " +
      "lower-third for a key name or claim, a quote card for a punchy line. Graphics are SCARCE — " +
      "one or two per minute at most, only for the strongest moments; most lines get nothing. " +
      "Times must land ON the moment the thing is said.";

    const contents = [
      `Episode: "${script.title}" — about ${config.topic}. Total ${speech.durationSec.toFixed(0)}s.`,
      `Return at most ${budget} cues (~1-2 per minute), non-overlapping, each 2.5–5s, spread across the episode.`,
      "Prefer stat cards for memorable numbers and b-roll for concrete visuals; lower-third/quote sparingly.",
      "For b-roll, write a concrete imagePrompt — and put NO text in the image.",
      "",
      "Transcript (timestamps in seconds):",
      transcript,
    ].join("\n");

    log.info(`analyzing transcript with ${options.cueModel}`);

    const raw = await gemini.generateStructured<RawCue[]>({
      model: options.cueModel,
      system,
      contents,
      schema: cueSchema(cueTypes),
      // No thinkingBudget cap → the Pro model deliberates on placement (same as the script stage).
    });

    const hostByTurn = new Map(script.turns.map((t) => [t.index, t.hostId]));

    // Clean: clamp to audio, enforce min/max length, sort, drop overlaps, cap count.
    const out: Cue[] = [];
    let lastEnd = -1;
    raw
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .filter((c) => cueTypes.includes(c.type))
      .sort((a, b) => a.start - b.start)
      .forEach((c, i) => {
        if (out.length >= budget) return;
        const start = Math.max(0, Math.min(c.start, speech.durationSec - 1));
        const end = Math.min(Math.max(start + 2.5, c.end), speech.durationSec, start + 5);
        if (start < lastEnd + 0.4) return; // keep a beat of air between cues
        lastEnd = end;
        const hostId = c.turnIndex != null ? hostByTurn.get(c.turnIndex) : undefined;
        out.push({
          id: `cue-${i}`,
          start,
          end,
          type: c.type,
          ...(c.title ? { title: c.title.trim() } : {}),
          ...(c.subtitle ? { subtitle: c.subtitle.trim() } : {}),
          ...(c.figure ? { figure: c.figure.trim() } : {}),
          ...(c.imagePrompt ? { imagePrompt: c.imagePrompt.trim() } : {}),
          ...(hostId ? { hostId } : {}),
        });
      });
    cleaned = out;

    // Persist the plan BEFORE spending on images — the unit of resume.
    project.state.broll = { cues: cleaned };
    await project.save();
  } else {
    log.info(`reusing planned cue list (${cleaned.length} cues) from a previous run`);
  }

  // Generate b-roll images (only for type=broll). Always SQUARE, independent of the
  // video's own aspect ratio — the compose card is a fixed square inset (see
  // compose/builder.ts .broll-card), not a full-frame takeover, so a square source image
  // needs no cropping to fill it, whatever the video's own orientation is.
  const brollCues = cleaned.filter((c) => c.type === "broll" && c.imagePrompt);
  if (brollCues.length)
    log.info(`generating ${brollCues.length} b-roll images with ${options.brollImageModel}`);

  for (const cue of brollCues) {
    if (signal?.aborted) throw new Error("run cancelled");
    // Content-addressed filename: an identical prompt reuses its image for free,
    // a changed prompt regenerates — a re-suggest can never show a stale image.
    const rel = brollImagePath(cue);
    const outPath = project.abs(rel);
    if (!fileExists(outPath)) {
      await gemini.generateImageToFile({
        // Nano Banana 2 Lite: ~4s and ~$0.034 per image — right for b-roll,
        // where volume beats per-image fidelity (host faces keep full NB2).
        model: options.brollImageModel,
        prompt: brollImagePrompt(cue.imagePrompt!),
        aspectRatio: "1:1",
        imageSize: "1K",
        outputPath: outPath,
      });
    }
    cue.imagePath = rel;
  }

  project.state.broll = { cues: cleaned };
  project.markDone("broll", {
    cues: cleaned.length,
    byType: countBy(cleaned.map((c) => c.type)),
  });
  await project.save();
  log.success(`${cleaned.length} cues (${brollCues.length} b-roll images)`);
}

function countBy(items: string[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});
}

/**
 * Wrap a raw b-roll image idea in the shared studio look. Exported so single-cue
 * regeneration (web API) produces images that match the batch-generated ones.
 */
export function brollImagePrompt(idea: string): string {
  return [
    idea,
    "Editorial, premium, photoreal or clean 3D. Dark moody palette with subtle electric-cyan",
    "accents to match the studio. Strong single subject, cinematic depth. Absolutely no text,",
    "letters, captions, or watermark in the image.",
  ].join(" ");
}
