import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Project, clearStages, withProjectLock } from "@podframes/core";
import { findRepoRoot, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere } from "@/lib/runs";
import { projectSummary } from "@/lib/dto";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Per-host face control.
 *   multipart/form-data { hostId, file } → upload a reference photo as the host's base.
 *   No Gemini face-edit path here: the video stage always starts from the base avatar image.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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
    const ctype = req.headers.get("content-type") ?? "";

    // ── Upload: just save the base + point the host at it. No image generation. ──
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const hostId = String(form.get("hostId") ?? "");
      const file = form.get("file");
      if (!(file instanceof File)) return new Response("file is required", { status: 400 });
      if (!s.config.hosts.some((h) => h.id === hostId)) return new Response("unknown host", { status: 400 });

      const rel = join("stills", `${hostId}-base.png`);
      const abs = project.abs(rel);
      await mkdir(dirname(abs), { recursive: true });
      const prior = s.uploads?.[hostId];
      if (prior && prior !== rel) await rm(project.abs(prior), { force: true });
      await writeFile(abs, Buffer.from(await file.arrayBuffer()));
      s.uploads = { ...(s.uploads ?? {}), [hostId]: rel };
      const host = s.config.hosts.find((h) => h.id === hostId);
      if (host) delete host.avatarKey;

      // New base → rebuild stills state, re-animate, recompose.
      await clearStages(project, ["stills", "video", "compose", "render"]);
      await project.save();
      return Response.json({ ...projectSummary(s), hostId, uploads: s.uploads ?? null });
    }

    return new Response("unsupported face action", { status: 415 });
  });
}
