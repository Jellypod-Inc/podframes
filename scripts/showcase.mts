/**
 * podframes showcase runner — generates a reel of short, varied clips.
 *
 *   pnpm tsx scripts/showcase.mts [count]   # default: all clips
 *
 * Builds a roster of 6 hosts (mixing Gemini + ElevenLabs voices), generates each
 * host's 9:16 still once, then runs N short clips (2-3 turns) reusing those stills
 * — every clip a different host pairing, caption style, and topic. Resumable.
 */
import { mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  Project,
  GeminiClient,
  resolveEnv,
  MODELS,
  type ConversationConfig,
  type Host,
  type CaptionStyle,
} from "@podframes/core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_DIR = join(ROOT, "projects", "_roster");

// ── ElevenLabs voice tuning for an expressive, lively read (eleven_v3) ─────────
const EXPRESSIVE = {
  voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.45, use_speaker_boost: true },
};

interface RosterHost {
  key: string;
  name: string;
  model: string;
  voice: string;
  persona: string;
  appearance: string;
  providerOptions?: Record<string, unknown>;
}

// 3 Gemini-voiced + 3 ElevenLabs-voiced; clips always pair one of each.
const ROSTER: RosterHost[] = [
  { key: "ada", name: "Ada", model: "google/gemini-3.1-flash-tts-preview", voice: "Aoede", persona: "warm, curious lead host", appearance: "East Asian woman early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face" },
  { key: "sol", name: "Sol", model: "google/gemini-3.1-flash-tts-preview", voice: "Puck", persona: "laid-back, funny", appearance: "Latino man mid-30s, short dark wavy hair, trimmed beard, warm olive skin, denim shirt, relaxed grin" },
  { key: "nia", name: "Nia", model: "google/gemini-3.1-flash-tts-preview", voice: "Leda", persona: "precise, endlessly curious", appearance: "South Asian woman late 20s, long dark wavy hair, brown skin, emerald green blouse, thoughtful" },
  { key: "theo", name: "Theo", model: "elevenlabs/eleven_v3", voice: "bIHbv24MWmeRgasZH58o", persona: "lively, energetic", appearance: "white man late 30s, light stubble, glasses, fair skin, charcoal henley, animated", providerOptions: EXPRESSIVE },
  { key: "maya", name: "Maya", model: "elevenlabs/eleven_v3", voice: "EXAVITQu4vr4xnSDxMaL", persona: "sharp, witty", appearance: "Black woman early 30s, voluminous natural curls, warm brown skin, mustard turtleneck, expressive", providerOptions: EXPRESSIVE },
  { key: "ren", name: "Ren", model: "elevenlabs/eleven_v3", voice: "iP95p4xoKVk53GoZ742B", persona: "deadpan, clever", appearance: "East Asian man early 30s, modern undercut hairstyle, light skin, black bomber jacket, cool composed", providerOptions: EXPRESSIVE },
];

interface ClipSpec {
  topic: string;
  pair: [string, string]; // [gemini host key, elevenlabs host key]
  captions: CaptionStyle;
  turns: number;
}

const CLIPS: ClipSpec[] = [
  { topic: "Is a hotdog a sandwich?", pair: ["ada", "theo"], captions: "clean", turns: 2 },
  { topic: "Why do cats purr?", pair: ["sol", "maya"], captions: "karaoke", turns: 3 },
  { topic: "Could you actually survive on Mars?", pair: ["nia", "ren"], captions: "highlight", turns: 2 },
  { topic: "The weirdest creature in the deep sea", pair: ["ada", "maya"], captions: "neon", turns: 3 },
  { topic: "Why is the ocean salty?", pair: ["sol", "ren"], captions: "slam", turns: 2 },
  { topic: "How do planes actually stay up?", pair: ["nia", "theo"], captions: "bold", turns: 3 },
  { topic: "Why do we dream?", pair: ["ada", "ren"], captions: "gradient", turns: 2 },
  { topic: "The fastest animal alive", pair: ["sol", "theo"], captions: "highlight", turns: 2 },
  { topic: "What actually is a black hole?", pair: ["nia", "maya"], captions: "karaoke", turns: 3 },
  { topic: "Why does coffee wake you up?", pair: ["ada", "theo"], captions: "neon", turns: 2 },
  { topic: "Are we living in a simulation?", pair: ["sol", "maya"], captions: "slam", turns: 3 },
  { topic: "Why do we get goosebumps?", pair: ["nia", "ren"], captions: "clean", turns: 2 },
];

function rosterStillPath(key: string): string {
  return join(ROSTER_DIR, `${key}.png`);
}

async function buildRoster(gemini: GeminiClient): Promise<void> {
  await mkdir(ROSTER_DIR, { recursive: true });
  for (const h of ROSTER) {
    const out = rosterStillPath(h.key);
    if (existsSync(out)) continue;
    console.log(`  roster still → ${h.name}`);
    await gemini.generateImageToFile({
      model: MODELS.imageModel,
      prompt:
        `${h.appearance}, sitting at a microphone in a modern podcast studio with dark charcoal acoustic ` +
        "foam panels and soft electric-cyan rim lighting. Vertical 9:16 portrait, single host, head and " +
        "shoulders, facing the camera with an alert, engaged, friendly expression, mouth closed and relaxed, " +
        "ready to speak — confident broadcaster presence. Photorealistic, premium, cinematic, shallow depth " +
        "of field. No on-screen text.",
      aspectRatio: "9:16",
      imageSize: "2K",
      outputPath: out,
    });
  }
}

function clipHost(r: RosterHost, id: string, speaker: string, side: "left" | "right"): Host {
  return {
    id,
    name: r.name,
    speaker,
    model: r.model,
    voice: r.voice,
    side,
    persona: r.persona,
    appearance: r.appearance,
    ...(r.providerOptions ? { providerOptions: r.providerOptions } : {}),
  };
}

async function injectStills(project: Project, keyA: string, keyB: string): Promise<void> {
  const dir = project.path("stills");
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {
    "host_a-avatar.png": keyA,
    "host_b-avatar.png": keyB,
  };
  for (const [name, key] of Object.entries(files)) await copyFile(rosterStillPath(key), join(dir, name));
  project.state.stills = {
    hosts: {
      host_a: { imagePath: project.rel(join(dir, "host_a-avatar.png")) },
      host_b: { imagePath: project.rel(join(dir, "host_b-avatar.png")) },
    },
  };
  project.markDone("stills", { injected: true });
  await project.save();
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 28);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const REGEN = args.includes("regen");
  const RECOMPOSE = args.includes("recompose");
  const numArg = args.find((a) => /^\d+$/.test(a));
  const count = numArg ? Number.parseInt(numArg, 10) : CLIPS.length;
  const env = resolveEnv(ROOT);
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY required");
  const gemini = new GeminiClient({ apiKey: env.geminiApiKey });

  console.log(`\npodframes showcase — roster of ${ROSTER.length} hosts, ${Math.min(count, CLIPS.length)} clips\n`);
  await buildRoster(gemini);

  const byKey = new Map(ROSTER.map((h) => [h.key, h]));
  const done: string[] = [];

  for (let i = 0; i < Math.min(count, CLIPS.length); i++) {
    const clip = CLIPS[i]!;
    const [keyA, keyB] = clip.pair;
    const a = byKey.get(keyA)!;
    const b = byKey.get(keyB)!;
    const slug = `clip-${String(i + 1).padStart(2, "0")}-${slugify(clip.topic)}`;

    const config: ConversationConfig = {
      topic: clip.topic,
      styleNote: "snappy and punchy — a fun, fast back-and-forth with a memorable fact",
      targetTurns: clip.turns,
      maxWordsPerTurn: 16,
      aspectRatio: "9:16",
      hosts: [clipHost(a, "host_a", "HOST_A", "left"), clipHost(b, "host_b", "HOST_B", "right")],
      options: {
        videoProvider: "fal-ltx",
        captionStyle: clip.captions,
        // The official reel SHOWS the mix: provider speaker tags + branding on —
        // shares should attribute back to podframes/Speechbase.
        branding: true,
        titleCard: false,
        showSpeakerTags: true,
        videoResolution: "720p",
        renderQuality: "high",
        maxCues: 2,
        fps: 30,
      },
    };

    console.log(`\n━━ clip ${i + 1}/${count}: "${clip.topic}"  ·  ${a.name}(${a.voice}) + ${b.name}(${b.voice})  ·  ${clip.captions} ━━`);

    const projDir = join(ROOT, "projects", slug);
    const outPath = join(projDir, "output.mp4");
    const exists = existsSync(outPath);

    if (exists && RECOMPOSE) {
      // Fast iteration: rebuild composition → render only, reusing cached avatar clips.
      console.log("  recompose: rebuilding composition → render (reusing avatar clips)");
      for (const sub of ["composition", "output.mp4"]) await rm(join(projDir, sub), { recursive: true, force: true });
      try {
        await generate(config, { root: ROOT, slug, only: ["compose", "render"], force: true, console: true });
        done.push(outPath);
      } catch (err) {
        console.error(`  ✗ recompose failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }

    if (exists && !REGEN) {
      console.log("  already rendered, skipping (`regen` = re-cut video→render, `recompose` = composition only)");
      done.push(outPath);
      continue;
    }

    const project = await Project.open(config, ROOT, slug);
    if (REGEN && exists) {
      // Re-cut video→render only: drop the fal clips + composition, keep script/speech/stills/broll.
      console.log("  regen: re-cutting video → render (reusing script/speech/stills/broll)");
      for (const sub of ["clips", "composition", "output.mp4"]) await rm(join(projDir, sub), { recursive: true, force: true });
      project.state.clips = undefined;
      project.state.composition = undefined;
      project.state.output = undefined;
      for (const st of ["video", "compose", "render"] as const) project.state.stages[st] = { status: "pending" };
      await project.save();
    }
    // Inject roster stills so the stills stage stays skipped.
    await injectStills(project, keyA, keyB);
    try {
      const result = await generate(config, { root: ROOT, slug, console: true });
      if (result.state.output) done.push(project.abs(result.state.output.videoPath));
    } catch (err) {
      console.error(`  ✗ clip failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n✓ showcase done — ${done.length} clips:\n${done.map((p) => "  " + p).join("\n")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
