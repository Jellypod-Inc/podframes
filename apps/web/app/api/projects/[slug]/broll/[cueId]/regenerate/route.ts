import { rm } from "node:fs/promises";
import { Project, GeminiClient, resolveEnv, clearStages, brollImagePrompt, brollImagePath, brollImageGeometry, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { projectSummary } from "@/lib/dto";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Regenerate ONE b-roll cue's image (optionally with a new prompt), matching the
 *  batch studio look via `brollImagePrompt`. Invalidates compose+render only. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; cueId: string }> },
) {
  const { slug, cueId } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();

  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — try again when it finishes.", { status: 409 });
  }

  return withProjectLock(safe, async () => {
    // Project.load never touches config/options — the persisted state is the truth.
    const project = await Project.load(root, safe);
    if (!project) return new Response("not found", { status: 404 });
    const s = project.state;

    const cue = s.broll?.cues.find((c) => c.id === cueId);
    if (!cue) return new Response("cue not found", { status: 404 });
    if (cue.type !== "broll") return new Response("cue is not a b-roll cue", { status: 400 });

    const body = (await req.json().catch(() => ({}))) as { imagePrompt?: string };
    if (typeof body.imagePrompt === "string" && body.imagePrompt.trim()) cue.imagePrompt = body.imagePrompt.trim();
    if (!cue.imagePrompt) return new Response("cue has no imagePrompt", { status: 400 });

    const env = resolveEnv(root);
    if (!env.geminiApiKey) return new Response("GEMINI_API_KEY not set", { status: 400 });
    const gemini = new GeminiClient({ apiKey: env.geminiApiKey });

    // Content-addressed name (same scheme as the batch stage): a prompt change
    // regenerates under a new name; re-rolling the SAME prompt replaces the file.
    // Geometry follows the treatment (square card vs cinematic full-frame),
    // exactly like the batch stage, so a regen never mismatches the composition.
    const geometry = brollImageGeometry(s.options.visualTreatment, s.config.aspectRatio);
    const prior = cue.imagePath;
    const rel = brollImagePath(cue, geometry.aspectRatio);
    const outPath = project.abs(rel);
    await rm(outPath, { force: true });
    await gemini.generateImageToFile({
      model: s.options.brollImageModel,
      prompt: brollImagePrompt(cue.imagePrompt),
      aspectRatio: geometry.aspectRatio,
      imageSize: geometry.imageSize,
      outputPath: outPath,
    });
    cue.imagePath = rel;
    if (prior && prior !== rel) await rm(project.abs(prior), { force: true });

    await clearStages(project, ["compose", "render"]);
    await project.save();

    return Response.json({
      ...projectSummary(s),
      cue,
      imageUrl: `/api/media/${safe}/${cue.imagePath}?v=${Date.now()}`,
    });
  });
}
