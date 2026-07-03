/**
 * podframes launch demos — the 3 clips that feed the launch video.
 *
 *   pnpm tsx scripts/launch-demos.mts            # generate all three (resumable)
 *   pnpm tsx scripts/launch-demos.mts speech     # stop after speech — review scripts/audio cheap
 *   pnpm tsx scripts/launch-demos.mts recompose  # rebuild composition → render only
 *   pnpm tsx scripts/launch-demos.mts rebroll    # regenerate b-roll cues + composition (no render)
 *
 * 1. demo-meet-podframes   16:9  karaoke   Ada+Theo   — the meta hero: the product demos itself
 * 2. demo-what-this-cost   9:16  highlight Sol+Maya   — per-second economics, receipt energy
 * 3. demo-dinosaurs        9:16  neon      Nia+Ren    — "normal" content showing b-roll range
 *
 * Same roster + official-reel settings as scripts/showcase.mts (fal-ltx, branding on).
 * 9:16 clips reuse projects/_roster stills; the 16:9 hero generates its own.
 */
import { mkdir, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generate,
  Project,
  type ConversationConfig,
  type Host,
  type CaptionStyle,
} from "@podframes/core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_DIR = join(ROOT, "projects", "_roster");

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

const ROSTER: Record<string, RosterHost> = {
  ada: { key: "ada", name: "Ada", model: "google/gemini-3.1-flash-tts-preview", voice: "Aoede", persona: "warm, curious lead host", appearance: "East Asian woman early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face" },
  sol: { key: "sol", name: "Sol", model: "google/gemini-3.1-flash-tts-preview", voice: "Puck", persona: "laid-back, funny", appearance: "Latino man mid-30s, short dark wavy hair, trimmed beard, warm olive skin, denim shirt, relaxed grin" },
  nia: { key: "nia", name: "Nia", model: "google/gemini-3.1-flash-tts-preview", voice: "Leda", persona: "precise, endlessly curious", appearance: "South Asian woman late 20s, long dark wavy hair, brown skin, emerald green blouse, thoughtful" },
  theo: { key: "theo", name: "Theo", model: "elevenlabs/eleven_v3", voice: "bIHbv24MWmeRgasZH58o", persona: "lively, energetic", appearance: "white man late 30s, light stubble, glasses, fair skin, charcoal henley, animated", providerOptions: EXPRESSIVE },
  maya: { key: "maya", name: "Maya", model: "elevenlabs/eleven_v3", voice: "EXAVITQu4vr4xnSDxMaL", persona: "sharp, witty", appearance: "Black woman early 30s, voluminous natural curls, warm brown skin, mustard turtleneck, expressive", providerOptions: EXPRESSIVE },
  ren: { key: "ren", name: "Ren", model: "elevenlabs/eleven_v3", voice: "iP95p4xoKVk53GoZ742B", persona: "deadpan, clever", appearance: "East Asian man early 30s, modern undercut hairstyle, light skin, black bomber jacket, cool composed", providerOptions: EXPRESSIVE },
};

interface DemoSpec {
  slug: string;
  topic: string;
  styleNote: string;
  pair: [string, string]; // host_a key, host_b key — always one Gemini + one ElevenLabs voice
  aspect: "16:9" | "9:16";
  captions: CaptionStyle;
  turns: number;
  maxWordsPerTurn: number;
  maxCues: number;
  /** 9:16 demos reuse the roster stills; the 16:9 hero generates fresh ones. */
  useRosterStills: boolean;
  /** Video backend + generation resolution (hero runs p-video @1080p; the rest fal-ltx @720p). */
  videoProvider?: "replicate-p-video" | "fal-ltx";
  videoResolution?: "720p" | "1080p";
}

const DEMOS: DemoSpec[] = [
  {
    slug: "demo-meet-podframes",
    topic:
      "podframes — the open-source tool that made this very video, and the two hosts slowly realizing " +
      "they ARE the demo. The accurate facts to work with: one line of input produced everything the " +
      "viewer is watching. Gemini wrote this script. Speechbase mixed two completely different " +
      "text-to-speech providers into one leveled conversation — Ada's voice is Google, Theo's is " +
      "ElevenLabs — and returned word-level timestamps. Their faces are AI images lip-synced to this " +
      "real audio, one clip per spoken turn. The word-timed captions on screen come from those same " +
      "timestamps. It all runs locally on your machine with your own API keys — clone the repo, run one " +
      "command, and it makes one of these about any topic you type. Open source, Apache-2.0.",
    styleNote:
      "self-aware and delightful — start like a normal show, then Theo notices something is off and the " +
      "penny drops that they are AI hosts inside the demo; playful, never cringe, every technical claim " +
      "must match the facts in the topic; end with an invitation: type a topic, get a show",
    pair: ["ada", "theo"],
    aspect: "16:9",
    captions: "karaoke",
    turns: 10,
    maxWordsPerTurn: 18,
    maxCues: 1,
    useRosterStills: false,
    videoProvider: "replicate-p-video",
    videoResolution: "1080p",
  },
  {
    slug: "demo-what-this-cost",
    topic:
      "How much did it cost to make this exact video? The real receipt for an AI video podcast, read " +
      "out loud: the script costs fractions of a cent, the two voices cost a few cents (text-to-speech " +
      "is priced per character), each host portrait is about a dime, and the expensive line item is the " +
      "lip-synced video — roughly ten cents for every second either of them talks. So this whole clip " +
      "is a couple of dollars, and a full 90-second episode is under ten. The punchline: video was the " +
      "one media format you couldn't make for coffee money, and now it is.",
    styleNote:
      "punchy, funny, radical price transparency — two friends reading a receipt out loud, genuinely " +
      "amazed the total is coffee money; keep the numbers exactly as given",
    pair: ["sol", "maya"],
    aspect: "9:16",
    captions: "highlight",
    turns: 6,
    maxWordsPerTurn: 16,
    maxCues: 1,
    useRosterStills: true,
  },
  {
    slug: "demo-dinosaurs",
    topic:
      "The day the dinosaurs died — the Chicxulub impact, told hour by hour. A rock the size of Mount " +
      "Everest moving at 20 kilometers per second, an impact with the energy of billions of atomic " +
      "bombs, global wildfires within hours, years of impact winter, and the one lucky reason our " +
      "shrew-sized ancestors made it through.",
    styleNote:
      "cinematic and awestruck but fast — vivid concrete images and numbers that beg for b-roll; ends " +
      "on the mammal twist",
    pair: ["nia", "ren"],
    aspect: "9:16",
    captions: "neon",
    turns: 6,
    maxWordsPerTurn: 16,
    maxCues: 1,
    useRosterStills: true,
  },
];

function toHost(r: RosterHost, id: string, speaker: string, side: "left" | "right"): Host {
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
  for (const [name, key] of Object.entries(files))
    await copyFile(join(ROSTER_DIR, `${key}.png`), join(dir, name));
  project.state.stills = {
    hosts: {
      host_a: { imagePath: project.rel(join(dir, "host_a-avatar.png")) },
      host_b: { imagePath: project.rel(join(dir, "host_b-avatar.png")) },
    },
  };
  project.markDone("stills", { injected: true });
  await project.save();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const RECOMPOSE = argv.includes("recompose");
  const REBROLL = argv.includes("rebroll");
  const SPEECH_ONLY = argv.includes("speech");
  const done: string[] = [];

  for (const demo of DEMOS) {
    const a = ROSTER[demo.pair[0]]!;
    const b = ROSTER[demo.pair[1]]!;

    const config: ConversationConfig = {
      topic: demo.topic,
      styleNote: demo.styleNote,
      targetTurns: demo.turns,
      maxWordsPerTurn: demo.maxWordsPerTurn,
      aspectRatio: demo.aspect,
      hosts: [toHost(a, "host_a", "HOST_A", "left"), toHost(b, "host_b", "HOST_B", "right")],
      options: {
        videoProvider: demo.videoProvider ?? "fal-ltx",
        captionStyle: demo.captions,
        videoResolution: demo.videoResolution ?? "720p",
        renderQuality: "high",
        maxCues: demo.maxCues,
        fps: 30,
      },
    };

    console.log(`\n━━ ${demo.slug}  ·  ${a.name}(${a.voice}) + ${b.name}(${b.voice})  ·  ${demo.aspect} ${demo.captions} ━━`);

    const projDir = join(ROOT, "projects", demo.slug);
    const outPath = join(projDir, "output.mp4");

    if (REBROLL) {
      console.log("  rebroll: regenerating b-roll cues + composition (render separately)");
      await generate(config, { root: ROOT, slug: demo.slug, only: ["broll", "compose"], force: true, console: true });
      continue;
    }
    if (RECOMPOSE) {
      // Rebuild the composition only — render externally with `hyperframes render
      // --workers 1` (multi-worker capture crops 87px off the bottom on this machine).
      console.log("  recompose: rebuilding composition (reusing clips/cues; render separately)");
      for (const sub of ["composition", "output.mp4"]) await rm(join(projDir, sub), { recursive: true, force: true });
      await generate(config, { root: ROOT, slug: demo.slug, only: ["compose"], force: true, console: true });
      continue;
    }
    if (existsSync(outPath)) {
      console.log("  already rendered, skipping");
      done.push(outPath);
      continue;
    }

    if (demo.useRosterStills) {
      const project = await Project.open(config, ROOT, demo.slug);
      await injectStills(project, demo.pair[0], demo.pair[1]);
    }
    const result = await generate(config, {
      root: ROOT,
      slug: demo.slug,
      console: true,
      ...(SPEECH_ONLY ? { to: "speech" as const } : {}),
    });
    if (result.state.output) done.push(join(projDir, result.state.output.videoPath));
  }

  console.log(`\n✓ launch demos — ${done.length}/3 rendered:\n${done.map((p) => "  " + p).join("\n")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
