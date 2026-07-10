import { join, isAbsolute } from "node:path";
import { mergeOptions } from "./config";
import { SCHEMA_VERSION } from "./shared";
import { ensureDir, fileExists, readJson, remove, slugForTopic, slugify, writeJson } from "./util/fs";
import type { ConversationConfig, ProjectState, StageName } from "./types";

/**
 * On-disk layout of a single run:
 *
 *   projects/<slug>/
 *   ├── project.json          ← {@link ProjectState} (resume source of truth)
 *   ├── script.json
 *   ├── audio/conversation.(mp3|wav)
 *   ├── audio/alignment.json
 *   ├── stills/<host-id>-base.png
 *   ├── clips/<id>.mp4
 *   ├── broll/<id>.png
 *   ├── composition/          ← assembled HyperFrames project (index.html + media)
 *   └── output.mp4
 */
export class Project {
  readonly dir: string;
  readonly slug: string;
  /** The on-disk `updatedAt` this instance was loaded from — used to detect concurrent writes. */
  private loadedUpdatedAt?: string;

  constructor(
    public state: ProjectState,
    public readonly root: string,
  ) {
    this.slug = state.slug;
    this.dir = join(root, "projects", state.slug);
    this.loadedUpdatedAt = state.updatedAt;
  }

  /** Absolute path inside the project dir. */
  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  /** Make a path relative to the project dir (for storing in state). */
  rel(absPath: string): string {
    return isAbsolute(absPath) ? absPath.slice(this.dir.length + 1) : absPath;
  }

  /** Resolve a project-relative path back to absolute. */
  abs(relPath: string): string {
    return isAbsolute(relPath) ? relPath : join(this.dir, relPath);
  }

  async save(): Promise<void> {
    const statePath = this.path("project.json");
    // Optimistic concurrency: if the file changed since we loaded it, another
    // writer slipped in — refuse rather than silently clobber their changes.
    // (withProjectLock prevents this in-process; this catches cross-process, e.g.
    // a CLI run alongside the web studio.)
    if (this.loadedUpdatedAt && fileExists(statePath)) {
      const onDisk = await readJson<ProjectState>(statePath).catch(() => null);
      if (onDisk?.updatedAt && onDisk.updatedAt !== this.loadedUpdatedAt) {
        throw new Error(
          `project "${this.slug}" was modified on disk since it was opened (concurrent edit). Reload and retry.`,
        );
      }
    }
    this.state.updatedAt = new Date().toISOString();
    await writeJson(statePath, this.state);
    this.loadedUpdatedAt = this.state.updatedAt;
  }

  // ── Stage status helpers ──────────────────────────────────────────────────

  stageDone(name: StageName): boolean {
    return this.state.stages[name]?.status === "done";
  }

  markRunning(name: StageName): void {
    this.state.stages[name] = {
      ...this.state.stages[name],
      status: "running",
      startedAt: new Date().toISOString(),
      error: undefined,
    };
  }

  markDone(name: StageName, notes?: Record<string, unknown>): void {
    this.state.stages[name] = {
      ...this.state.stages[name],
      status: "done",
      finishedAt: new Date().toISOString(),
      ...(notes ? { notes: { ...this.state.stages[name]?.notes, ...notes } } : {}),
    };
  }

  markError(name: StageName, error: unknown): void {
    this.state.stages[name] = {
      ...this.state.stages[name],
      status: "error",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  static async create(
    config: ConversationConfig,
    root: string,
    slugHint?: string,
  ): Promise<Project> {
    const slug = slugHint ? slugify(slugHint) : slugForTopic(config.topic);
    const now = new Date().toISOString();
    const state: ProjectState = {
      schemaVersion: SCHEMA_VERSION,
      slug,
      createdAt: now,
      updatedAt: now,
      config,
      options: mergeOptions(config.options),
      stages: {},
    };
    const project = new Project(state, root);
    await ensureDir(project.dir);
    await project.save();
    return project;
  }

  /**
   * Load an existing project by slug without applying new config overrides.
   * Missing non-breaking option defaults are filled in memory so older v3
   * projects keep opening when a new optional output treatment is introduced.
   * This is what quick-edit routes and re-runs should use; {@link open} is the
   * create-or-resume entry for a fresh generate call.
   */
  static async load(root: string, slug: string): Promise<Project | null> {
    const statePath = join(root, "projects", slug, "project.json");
    if (!fileExists(statePath)) return null;
    const state = await readJson<ProjectState>(statePath);
    checkSchema(state, slug);
    state.options = mergeOptions(state.options);
    return new Project(state, root);
  }

  /**
   * Permanently delete a project and every artifact stored beside project.json:
   * script, audio, stills, clips, b-roll, composition media, and final renders.
   * Only directories containing project.json qualify, so shared folders such as
   * roster caches are never removed by accident.
   */
  static async delete(root: string, slug: string): Promise<boolean> {
    const dir = join(root, "projects", slug);
    if (!fileExists(join(dir, "project.json"))) return false;
    await remove(dir);
    return true;
  }

  /** Load an existing run for resume; create it if absent. */
  static async open(
    config: ConversationConfig,
    root: string,
    slugHint?: string,
  ): Promise<Project> {
    const slug = slugHint ? slugify(slugHint) : slugForTopic(config.topic);
    const statePath = join(root, "projects", slug, "project.json");
    if (fileExists(statePath)) {
      const state = await readJson<ProjectState>(statePath);
      checkSchema(state, slug);
      // Keep options current with any new config-level overrides, without clobbering artifacts.
      state.options = mergeOptions({ ...state.options, ...config.options });
      return new Project(state, root);
    }
    return Project.create(config, root, slugHint);
  }
}

function checkSchema(state: ProjectState, slug: string): void {
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `project "${slug}" uses an unsupported project.json schema (found ${state.schemaVersion ?? "none"}, ` +
        `need ${SCHEMA_VERSION}). Delete projects/${slug} and regenerate.`,
    );
  }
}
