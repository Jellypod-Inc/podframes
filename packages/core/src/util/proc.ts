import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Stream child stdout/stderr to the parent. */
  inherit?: boolean;
  /** Called with each chunk of stdout (when not inheriting). */
  onStdout?: (chunk: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Promise wrapper around child_process.spawn. Rejects on non-zero exit.
 *  With `inherit`, stdout streams to the parent but stderr is BOTH streamed and
 *  captured — a failing child (e.g. the render) must still produce a real error
 *  message, not just "exited with code 1". */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.inherit ? ["ignore", "inherit", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (opts.inherit) process.stderr.write(d);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const result: RunResult = { code: code ?? 0, stdout, stderr };
      if (code === 0) resolvePromise(result);
      else
        reject(
          new Error(
            `\`${cmd} ${args.join(" ")}\` exited with code ${code}\n${stderr || stdout}`.trim(),
          ),
        );
    });
  });
}

/** Run a binary resolved from the workspace's node_modules/.bin (e.g. hyperframes). */
export function runBin(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  // Prefer the locally-installed binary; fall back to PATH.
  return run(bin, args, opts);
}

/**
 * Verify an external binary is on PATH (via `<bin> -version`); throw a friendly
 * install hint if it's missing. Use as a preflight so we fail before any spend.
 */
export async function ensureBinary(bin: string, hint: string): Promise<void> {
  try {
    await run(bin, ["-version"]);
  } catch {
    throw new Error(`Required binary "${bin}" was not found on PATH. ${hint}`);
  }
}
