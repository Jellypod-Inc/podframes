#!/usr/bin/env node
import { parseArgs } from "node:util";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  generate,
  resolveEnv,
  DEFAULT_HOSTS,
  STAGE_NAMES,
  providerOf,
  type CaptionStyle,
  type ConversationConfig,
  type Host,
  type StageName,
  type VisualTreatment,
} from "@podframes/core";

const HELP = `
podframes — turn a topic into an animated AI podcast video.

USAGE
  podframes generate --topic "<topic>" [options]
  podframes doctor
  podframes stages
  podframes --help

OPTIONS
  --topic <str>        Conversation topic (required unless --config)
  --config <file>      Load a full ConversationConfig JSON (overrides flags)
  --style <str>        Tone/format note, e.g. "playful, debate-style"
  --turns <n>          Approx number of turns (default 14)
  --aspect <ratio>     16:9 (default) or 9:16
  --language <code>    Language code (default en)
  --slug <name>        Override the project folder name

  --host-a "<name|model|voice>"   e.g. "Ada|openai/gpt-4o-mini-tts|alloy"
  --host-b "<name|model|voice>"   e.g. "Theo|elevenlabs/eleven_v3|JBFqn..."

  --provider <p>       Video backend: replicate-p-video (default, cheaper) | fal-ltx (higher-quality alt)
  --treatment <t>      minimal (default) | editorial | cinematic
  --captions <s>       clean | karaoke | highlight | neon | slam | bold | gradient | boxed
  --resolution <r>     720p (default) | 1080p
  --draft              Fast, lower-quality render (good for iterating)

  --from <stage>       Start at this stage
  --to <stage>         Stop after this stage
  --only <s1,s2>       Run only these stages
  --force              Re-run stages even if already done

STAGES
  ${STAGE_NAMES.join(" → ")}

EXAMPLES
  podframes generate --topic "Why is the sky blue?" --turns 10
  podframes generate --topic "The history of coffee" --aspect 9:16 --draft
  podframes generate --topic "AI agents" --only script,speech
  podframes generate --slug ai-agents --from stills
`;

const COMMANDS = new Set(["generate", "doctor", "stages", "help"]);

/** Preflight the environment: node, ffmpeg, and which keys are set. */
async function doctor(root: string): Promise<void> {
  const ok = (b: boolean) => (b ? "✓" : "✗");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const has = (bin: string) =>
    new Promise<boolean>((res) => {
      exec(`${bin} -version`, (err) => res(!err));
    });
  const [ffmpeg, ffprobe] = await Promise.all([has("ffmpeg"), has("ffprobe")]);
  const env = resolveEnv(root);
  const keys: Array<[string, boolean, string]> = [
    ["SPEECHBASE_API_KEY", !!env.speechbaseApiKey, "the mixed conversation audio (required)"],
    ["GEMINI_API_KEY", !!env.geminiApiKey, "script, stills, b-roll (required)"],
    ["REPLICATE_API_KEY", !!env.replicateApiKey, "the default replicate-p-video lip-sync video (required for the default path)"],
    ["FAL_API_KEY", !!env.falApiKey, "only if you switch --provider fal-ltx"],
  ];
  console.log(`\n  podframes doctor\n`);
  console.log(`  ${ok(nodeMajor >= 22)} node ${process.versions.node} ${nodeMajor >= 22 ? "" : "(need >= 22)"}`);
  console.log(`  ${ok(ffmpeg)} ffmpeg ${ffmpeg ? "on PATH" : "MISSING — brew install ffmpeg"}`);
  console.log(`  ${ok(ffprobe)} ffprobe ${ffprobe ? "on PATH" : "MISSING — ships with ffmpeg"}`);
  for (const [name, set, why] of keys) console.log(`  ${ok(set)} ${name} — ${why}`);
  console.log(`\n  keys load from ${root}/.env.local (cp .env.example .env.local)\n`);
  const required = !ffmpeg || !ffprobe || nodeMajor < 22 || !env.speechbaseApiKey || !env.geminiApiKey || !env.replicateApiKey;
  if (required) process.exitCode = 1;
}

function parseHost(spec: string, base: Host): Host {
  const [name, model, voice] = spec.split("|").map((s) => s.trim());
  return {
    ...base,
    ...(name ? { name, speaker: base.speaker } : {}),
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
  };
}

async function main(): Promise<void> {
  // Drop a leading bare `--` (pnpm forwards one through `run <script> -- args`).
  const raw = process.argv.slice(2);
  const argv = raw[0] === "--" ? raw.slice(1) : raw;
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "generate";

  if (argv.includes("--help") || argv.includes("-h") || command === "help") {
    console.log(HELP);
    return;
  }
  if (!COMMANDS.has(command)) {
    console.error(`error: unknown command "${command}" (valid: ${[...COMMANDS].join(", ")})\n`);
    console.log(HELP);
    process.exit(1);
  }
  if (command === "stages") {
    console.log(STAGE_NAMES.join("\n"));
    return;
  }

  const { values } = parseArgs({
    args: command === "generate" ? argv.slice(1) : argv,
    options: {
      topic: { type: "string" },
      config: { type: "string" },
      style: { type: "string" },
      turns: { type: "string" },
      aspect: { type: "string" },
      language: { type: "string" },
      slug: { type: "string" },
      "host-a": { type: "string" },
      "host-b": { type: "string" },
      provider: { type: "string" },
      treatment: { type: "string" },
      captions: { type: "string" },
      resolution: { type: "string" },
      draft: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      only: { type: "string" },
      force: { type: "boolean" },
    },
    allowPositionals: true,
  });

  // Repo root = two levels up from apps/cli (so projects/ + .env.local resolve there).
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "..", "..");

  if (command === "doctor") {
    await doctor(root);
    return;
  }

  let config: ConversationConfig;
  if (values.config) {
    config = JSON.parse(await readFile(resolve(process.cwd(), values.config), "utf8"));
  } else {
    if (!values.topic) {
      console.error("error: --topic is required (or pass --config <file>)\n");
      console.log(HELP);
      process.exit(1);
    }
    const hostA = values["host-a"] ? parseHost(values["host-a"], DEFAULT_HOSTS[0]) : DEFAULT_HOSTS[0];
    const hostB = values["host-b"] ? parseHost(values["host-b"], DEFAULT_HOSTS[1]) : DEFAULT_HOSTS[1];
    config = {
      topic: values.topic,
      ...(values.style ? { styleNote: values.style } : {}),
      ...(values.turns ? { targetTurns: Number.parseInt(values.turns, 10) } : {}),
      hosts: [hostA, hostB],
      aspectRatio: values.aspect === "9:16" ? "9:16" : "16:9",
      ...(values.language ? { language: values.language } : {}),
      options: {
        ...(values.provider ? { videoProvider: values.provider as "fal-ltx" | "replicate-p-video" } : {}),
        ...(values.treatment ? { visualTreatment: values.treatment as VisualTreatment } : {}),
        ...(values.captions ? { captionStyle: values.captions as CaptionStyle } : {}),
        ...(values.resolution ? { videoResolution: values.resolution === "1080p" ? "1080p" : "720p" } : {}),
        ...(values.draft ? { renderQuality: "draft" as const } : {}),
      },
    };
  }
  // Config (incl. a raw --config JSON) is validated inside generate() before any
  // spend — bad flags/enums/hosts fail here with a message, not deep in a stage.

  const providers = [...new Set(config.hosts.map((h) => providerOf(h)))];
  console.log(`\n  podframes\n  topic: ${config.topic}\n  hosts: ${config.hosts
    .map((h) => `${h.name} (${providerOf(h)})`)
    .join(" · ")}\n  voices mixed across: ${providers.join(", ")}\n`);

  const startedAt = Date.now();
  const project = await generate(config, {
    root,
    ...(values.slug ? { slug: values.slug } : {}),
    ...(values.from ? { from: values.from as StageName } : {}),
    ...(values.to ? { to: values.to as StageName } : {}),
    ...(values.only ? { only: values.only.split(",").map((s) => s.trim() as StageName) } : {}),
    ...(values.force ? { force: true } : {}),
  });

  // End-of-run summary card — a multi-minute run deserves more than one log line.
  const s = project.state;
  const mins = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const line = "  ────────────────────────────────────────";
  console.log(`\n${line}`);
  if (s.script) console.log(`  "${s.script.title}"`);
  if (s.speech) {
    console.log(
      `  ${s.speech.durationSec.toFixed(0)}s · ${s.speech.turns.length} turns · ${s.speech.words.length} words · voices: ${providers.join(" + ")}`,
    );
  }
  if (s.output) {
    console.log(`  video  → projects/${project.slug}/${s.output.videoPath} (${(s.output.bytes / 1e6).toFixed(1)} MB)`);
  } else if (s.speech) {
    console.log(`  audio  → projects/${project.slug}/${s.speech.audioPath}`);
    console.log(`  next   → podframes generate --slug ${project.slug} --to render`);
  }
  console.log(`  took ${mins} min\n${line}\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
