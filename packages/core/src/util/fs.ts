import { mkdir, writeFile, readFile, copyFile, rm, rename, link } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Write JSON atomically: serialize to a temp file in the same dir, then rename
 * over the target (an atomic operation on POSIX). A reader never sees a partial
 * file, and a crash mid-write can't truncate the real one.
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/**
 * Write binary artifacts atomically (tmp + rename), same contract as writeJson.
 * Every downloaded clip/still/b-roll image funnels through here, and the stages
 * trust any existing file via `fileExists()` on resume — so a crash mid-write
 * must never leave a truncated file at the real path.
 */
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

export async function writeText(path: string, text: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, text, "utf8");
}

export async function copyInto(src: string, destDir: string, name?: string): Promise<string> {
  await ensureDir(destDir);
  const dest = join(destDir, name ?? src.split("/").pop()!);
  await copyFile(src, dest);
  return dest;
}

/**
 * Hardlink `src` into `destDir` (near-zero time and disk), falling back to a
 * copy when linking isn't possible (cross-device, unsupported fs). Used for the
 * composition's media dir, which otherwise byte-duplicates hundreds of MB of
 * clips on every recompose.
 */
export async function linkInto(src: string, destDir: string, name?: string): Promise<string> {
  await ensureDir(destDir);
  const dest = join(destDir, name ?? src.split("/").pop()!);
  await rm(dest, { force: true });
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
  return dest;
}

export async function remove(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export const fileExists = (path: string): boolean => existsSync(path);

/** kebab-case a string into a filesystem-safe slug (no hash — used for explicit slugs). */
export function slugify(input: string, maxLen = 48): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, maxLen)
    .replace(/^-|-$/g, "");
  return base || "conversation";
}

/** Tiny stable content hash (FNV-1a → base36) for cache keys and slug suffixes. */
export function contentHash(input: string, len = 6): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(len, "0").slice(0, len);
}

/**
 * Derive a project slug FROM A TOPIC: kebab-case plus a short topic hash, so
 * distinct topics can never collide on one directory (non-ASCII topics all
 * kebab to "conversation"; "AI Agents?" and "AI: agents!" both kebab to
 * "ai-agents"). Explicit user-chosen slugs go through plain {@link slugify}.
 */
export function slugForTopic(topic: string): string {
  return `${slugify(topic, 42)}-${contentHash(topic)}`;
}
