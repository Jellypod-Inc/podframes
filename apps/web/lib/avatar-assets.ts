import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROSTER } from "@/lib/roster";
import type { Project } from "@podframes/core";

/**
 * Materialize each roster-picked host's avatar into the project (the pipeline
 * only reads project-local files). Three guarantees:
 *
 *  1. The destination is KEYED by the roster preset (`<id>-roster-<key>.png`),
 *     so it can never collide with — or overwrite — a manually uploaded photo.
 *     A stale avatarKey from an out-of-date tab can at worst repoint the host
 *     back to the roster face (visible + recoverable), never destroy an upload.
 *  2. A missing roster source fails loudly BEFORE any state is persisted, with
 *     the path in the message — not as a raw ENOENT five stages later.
 *  3. Copies short-circuit when the keyed file already exists, so the routine
 *     is free on the autosave PATCHes that call it repeatedly.
 *
 * Mutates uploads only; the caller saves. Returns whether anything changed.
 */
export async function syncRosterAvatarUploads(project: Project): Promise<boolean> {
  let changed = false;
  for (const host of project.state.config.hosts) {
    if (!host.avatarKey) continue;
    const preset = ROSTER.find((r) => r.key === host.avatarKey);
    if (!preset) continue;
    const rel = join("stills", `${host.id}-roster-${preset.key}.png`);
    const dest = project.abs(rel);
    if (!existsSync(dest)) {
      const src = join(project.root, "apps", "web", "public", "roster", `${preset.key}.png`);
      if (!existsSync(src)) {
        throw new Error(
          `roster avatar image missing: ${src} — restore apps/web/public/roster or pick a different face`,
        );
      }
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
    if (project.state.uploads?.[host.id] !== rel) {
      project.state.uploads = { ...(project.state.uploads ?? {}), [host.id]: rel };
      changed = true;
    }
  }
  return changed;
}
