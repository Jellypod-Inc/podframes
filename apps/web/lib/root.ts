import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Walk up from cwd to find the monorepo root (where projects/ + .env.local live). */
export function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume apps/web → two levels up.
  return resolve(process.cwd(), "..", "..");
}

export const projectsDir = () => join(findRepoRoot(), "projects");

/** Sanitize a URL slug to its on-disk project dir name (defense-in-depth vs path traversal). */
export const safeSlug = (slug: string): string => slug.replace(/[^a-z0-9-]/gi, "");
