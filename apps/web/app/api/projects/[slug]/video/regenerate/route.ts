import { Project, clearTurnClips, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { projectSummary } from "@/lib/dto";

export const runtime = "nodejs";

/** Invalidate SPECIFIC turns' lip-sync clips (deletes just those files, keeps the rest
 *  cached) so a subsequent `generate({to:"video"})` re-animates only what was cleared —
 *  the "checkbox specific ones" regen action for the Videos step. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  const root = findRepoRoot();

  if (isRunActiveAnywhere(safe)) {
    return new Response("A generation run is in progress — try again when it finishes.", { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as { turnIndices?: number[] };
  const turnIndices = Array.isArray(body.turnIndices) ? body.turnIndices.filter((n) => Number.isInteger(n)) : [];
  if (!turnIndices.length) return new Response("turnIndices is required", { status: 400 });

  return withProjectLock(safe, async () => {
    const project = await Project.load(root, safe);
    if (!project) return new Response("not found", { status: 404 });

    await clearTurnClips(project, turnIndices);
    await project.save();

    return Response.json({ ...projectSummary(project.state), cleared: turnIndices });
  });
}
