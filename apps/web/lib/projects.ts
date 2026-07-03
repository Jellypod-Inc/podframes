import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@podframes/core";
import type { ProjectState, StageName } from "@podframes/core";
import { projectsDir, safeSlug } from "@/lib/root";
import { isRunActiveAnywhere, isRunActiveWeb } from "@/lib/runs";
import { projectSummary, projectDetail, type ProjectSummary, type ProjectDetail } from "@/lib/dto";

/** Server-only project reads. Used by both the RSC pages and the JSON route handlers. */

/**
 * Self-heal stranded state: the pipeline persists `status:"running"` per stage,
 * but if the owning process died mid-run, the disk still says "running" forever
 * and would lock the studio. Any "running" stage without a live run — in this
 * process OR another (the on-disk .run.lock covers live CLI runs) — demotes to
 * an actionable error on read. (Read-side only — nothing is written back; the
 * next real run overwrites it.)
 */
function reconcile(state: ProjectState): ProjectState {
  if (isRunActiveAnywhere(state.slug)) return state;
  for (const [name, rec] of Object.entries(state.stages)) {
    if (rec?.status === "running") {
      state.stages[name as StageName] = {
        ...rec,
        status: "error",
        error: "interrupted — the server stopped mid-run. Re-run this step to resume.",
      };
    }
  }
  return state;
}

/** The same schema gate Project.load enforces — these raw read paths must not
 *  hand an old on-disk shape to the UI (stale field names render as broken
 *  faces/clips). Old projects are refused, never migrated: clean-cutover rule. */
function currentSchema(state: ProjectState, where: string): boolean {
  if (state.schemaVersion === SCHEMA_VERSION) return true;
  console.warn(
    `[podframes] skipping ${where}: unsupported project.json schema ` +
      `(found ${state.schemaVersion ?? "none"}, need ${SCHEMA_VERSION}) — delete the project dir and regenerate.`,
  );
  return false;
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name, "project.json");
    if (!existsSync(p)) continue;
    try {
      const state = JSON.parse(await readFile(p, "utf8")) as ProjectState;
      if (!currentSchema(state, `projects/${e.name}`)) continue;
      out.push(projectSummary(reconcile(state)));
    } catch {
      /* skip malformed */
    }
  }
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return out;
}

export async function readProjectDetail(slug: string): Promise<ProjectDetail | null> {
  const safe = safeSlug(slug);
  const p = join(projectsDir(), safe, "project.json");
  if (!existsSync(p)) return null;
  try {
    const state = JSON.parse(await readFile(p, "utf8")) as ProjectState;
    if (!currentSchema(state, `projects/${safe}`)) return null;
    return { ...projectDetail(reconcile(state)), runActive: isRunActiveWeb(safe) };
  } catch {
    return null;
  }
}
