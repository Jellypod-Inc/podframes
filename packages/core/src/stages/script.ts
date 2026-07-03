import { Type } from "../clients/gemini";
import type { StageContext } from "./context";
import type { Script, ScriptTurn } from "../types";

interface RawScript {
  title: string;
  hook: string;
  turns: Array<{ speaker: string; text: string }>;
}

const scriptSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Short, punchy episode title (max 8 words)" },
    hook: { type: Type.STRING, description: "One-line hook (max 14 words)" },
    turns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING, description: "Exactly HOST_A or HOST_B" },
          text: { type: Type.STRING, description: "What this host says on their turn" },
        },
        required: ["speaker", "text"],
        propertyOrdering: ["speaker", "text"],
      },
    },
  },
  required: ["title", "hook", "turns"],
  propertyOrdering: ["title", "hook", "turns"],
};

export async function runScript(ctx: StageContext): Promise<void> {
  const { project, gemini, reporter } = ctx;
  const log = reporter.stage("script");
  const { config, options } = project.state;

  if (project.state.script && project.stageDone("script")) {
    log.info("cached", { turns: project.state.script.turns.length });
    return;
  }

  const [a, b] = config.hosts;
  const targetTurns = config.targetTurns ?? 14;

  const system = [
    "You are a senior podcast scriptwriter. You write tight, natural, two-host audio dialogue",
    "that sounds like real people — not a press release. No stage directions, no narrator, no",
    "markdown. Each turn is one speaker's spoken words only. Hosts interrupt, react, and build on",
    "each other. Avoid filler like 'great question'. Open with a hook, end with a clean button.",
  ].join(" ");

  const contents = [
    `Write a podcast conversation between two hosts about: "${config.topic}".`,
    config.styleNote ? `Style: ${config.styleNote}.` : "",
    "",
    `HOST_A is ${a.name} — ${a.persona ?? "the lead host"}.`,
    `HOST_B is ${b.name} — ${b.persona ?? "the co-host"}.`,
    "",
    `Aim for about ${targetTurns} turns, alternating HOST_A / HOST_B (start with HOST_A).`,
    config.maxWordsPerTurn
      ? `Keep each turn to ONE short, punchy sentence — at most ${config.maxWordsPerTurn} words. Fast and clippy.`
      : "Keep each turn to 1-3 sentences (~12-45 words) so it reads as snappy back-and-forth.",
    "Include at least two concrete facts, numbers, or examples the audience would remember —",
    "these will become on-screen b-roll moments.",
    config.language && config.language !== "en" ? `Write in ${config.language}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  log.info(`writing ~${targetTurns} turns with ${options.scriptModel}`);

  const raw = await gemini.generateStructured<RawScript>({
    model: options.scriptModel,
    system,
    contents,
    schema: scriptSchema,
  });

  const speakerToHost = new Map([
    [a.speaker.toUpperCase(), a.id],
    [b.speaker.toUpperCase(), b.id],
  ]);

  const turns: ScriptTurn[] = raw.turns
    .map((t, i): ScriptTurn | null => {
      const key = t.speaker.trim().toUpperCase();
      const hostId = speakerToHost.get(key) ?? (i % 2 === 0 ? a.id : b.id);
      const speaker = hostId === a.id ? a.speaker : b.speaker;
      const text = t.text.trim();
      if (!text) return null;
      return { index: i, hostId, speaker, text };
    })
    .filter((t): t is ScriptTurn => t !== null)
    .map((t, i) => ({ ...t, index: i }));

  if (turns.length < 2) throw new Error("Script generation produced fewer than 2 usable turns");

  const script: Script = { topic: config.topic, title: raw.title.trim(), hook: raw.hook.trim(), turns };
  project.state.script = script;
  project.markDone("script", { turns: turns.length, title: script.title });
  await project.save();

  log.success(`"${script.title}" — ${turns.length} turns`);
}
