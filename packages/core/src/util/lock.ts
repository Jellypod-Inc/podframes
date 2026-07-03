/**
 * Per-project run/write coordination.
 *
 * Within one Node process (the web server: API routes + RunManager pipelines)
 * an in-memory mutex serializes writers. But the CLI and the studio can point
 * at the SAME projects/ dir from different processes, so long runs ALSO take an
 * on-disk lock file (projects/<slug>/.run.lock with the owner pid) — a CLI run
 * and a studio run can never stomp each other, and readers can tell a live
 * cross-process run from a stale crashed one. Two concerns, two primitives:
 *
 *  • {@link withProjectLock} serializes write critical sections per slug, so two
 *    edits (or an edit and a pipeline save) never interleave (in-process).
 *  • {@link beginRun}/{@link isRunActive} flag a *long* pipeline run so quick-edit
 *    routes can return 409 immediately instead of queueing behind it for minutes
 *    (in-process AND cross-process via the lock file).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const tails = new Map<string, Promise<unknown>>();
const held = new Map<string, number>();
const runs = new Set<string>();
const diskLocks = new Map<string, string>();

/** The on-disk run-lock path for a project (root = where projects/ lives). */
export const runLockFile = (root: string, slug: string): string =>
  join(root, "projects", slug, ".run.lock");

function lockOwnerAlive(lockFile: string): number | null {
  try {
    const { pid } = JSON.parse(readFileSync(lockFile, "utf8")) as { pid?: number };
    if (!pid || pid === process.pid) return null; // our own lock is tracked in-memory
    process.kill(pid, 0); // throws if the process is gone → stale lock
    return pid;
  } catch {
    return null;
  }
}

/** True while a critical section is executing inside {@link withProjectLock}. */
export function isProjectBusy(slug: string): boolean {
  return (held.get(slug) ?? 0) > 0;
}

/** True from {@link beginRun} until {@link endRun} — a full pipeline run is in
 *  flight in THIS process, or (when `lockFile` is given) live in another one. */
export function isRunActive(slug: string, lockFile?: string): boolean {
  if (runs.has(slug)) return true;
  if (lockFile && existsSync(lockFile)) return lockOwnerAlive(lockFile) != null;
  return false;
}

/** Mark a long run active; throws if one already is — including a live run in
 *  ANOTHER process (CLI vs studio) when `lockFile` is given. A stale lock left
 *  by a crashed process is silently reclaimed. */
export function beginRun(slug: string, lockFile?: string): void {
  if (runs.has(slug)) {
    throw new Error(`A generation run is already in progress for "${slug}". Wait for it to finish.`);
  }
  if (lockFile) {
    if (existsSync(lockFile)) {
      const pid = lockOwnerAlive(lockFile);
      if (pid != null) {
        throw new Error(
          `A generation run is already in progress for "${slug}" (another process, pid ${pid}). Wait for it to finish.`,
        );
      }
    }
    mkdirSync(dirname(lockFile), { recursive: true });
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    diskLocks.set(slug, lockFile);
  }
  runs.add(slug);
}

export function endRun(slug: string): void {
  runs.delete(slug);
  const lockFile = diskLocks.get(slug);
  if (lockFile) {
    diskLocks.delete(slug);
    try {
      rmSync(lockFile, { force: true });
    } catch {
      /* a stray lock is reclaimed as stale on the next run */
    }
  }
}

/**
 * Serialize an async critical section per slug. Calls for the same slug run one
 * at a time in arrival order; different slugs run concurrently. The caller always
 * receives fn's own result/error, and a failed holder never rejects the next waiter.
 */
export async function withProjectLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(slug) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // The next waiter chains off this gate regardless of how prev/fn settle.
  tails.set(slug, prev.then(() => gate, () => gate));
  await prev.catch(() => {});
  held.set(slug, (held.get(slug) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = (held.get(slug) ?? 1) - 1;
    if (n <= 0) held.delete(slug);
    else held.set(slug, n);
    release();
  }
}
