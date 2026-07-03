import { existsSync } from "node:fs";
import { join } from "node:path";
import { Project, slugify } from "@podframes/core";
import type { ConversationConfig } from "@podframes/core";
import { listProjectSummaries } from "@/lib/projects";
import { findRepoRoot, projectsDir } from "@/lib/root";
import { projectDetail } from "@/lib/dto";
import { syncRosterAvatarUploads } from "@/lib/avatar-assets";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ projects: await listProjectSummaries() });
}

/** A free slug derived from the topic — never collides with an existing project. */
function uniqueSlug(topic: string): string {
  const base = slugify(topic);
  let slug = base;
  for (let n = 2; existsSync(join(projectsDir(), slug, "project.json")); n++) slug = `${base}-${n}`;
  return slug;
}

/**
 * Create an empty project (no stages run) so per-host face actions in Step 1 have a project
 * to write to before the topic/script exist. The slug is unique so it never hijacks an
 * existing project; a later topic edit keeps this slug (PATCH never re-slugs).
 */
export async function POST(req: Request) {
  let body: { config?: ConversationConfig };
  try {
    body = (await req.json()) as { config?: ConversationConfig };
  } catch {
    return new Response("invalid JSON body", { status: 400 });
  }
  if (!body?.config?.topic) return new Response("config.topic is required", { status: 400 });

  const root = findRepoRoot();
  const project = await Project.create(body.config, root, uniqueSlug(body.config.topic));
  if (await syncRosterAvatarUploads(project)) await project.save();
  return Response.json(projectDetail(project.state));
}
