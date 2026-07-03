import type { StageName } from "@podframes/core";
import { startRun } from "@/lib/runs";
import { safeSlug } from "@/lib/root";

export const runtime = "nodejs";

interface GenerateBody {
  slug: string;
  from?: StageName;
  to?: StageName;
  only?: StageName[];
  force?: boolean;
  onlyTurns?: number[];
}

/**
 * Kick off a pipeline run and return immediately (202). The run is owned by the
 * RunManager (lib/runs.ts) — progress streams from GET /api/projects/[slug]/run,
 * which survives reloads and reattaches from any tab. The project must already
 * exist (POST /api/projects creates it); its persisted config is the source of
 * truth, so no config rides along here.
 */
export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  if (!body?.slug || typeof body.slug !== "string") {
    return new Response("slug is required (create the project first via POST /api/projects)", { status: 400 });
  }

  const result = await startRun(safeSlug(body.slug), {
    from: body.from,
    to: body.to,
    only: body.only,
    force: body.force,
    onlyTurns: Array.isArray(body.onlyTurns) ? body.onlyTurns.filter((n) => Number.isInteger(n)) : undefined,
  });
  if (!result.ok) return new Response(result.message ?? "could not start run", { status: result.status });
  return Response.json({ slug: safeSlug(body.slug), started: true }, { status: 202 });
}
