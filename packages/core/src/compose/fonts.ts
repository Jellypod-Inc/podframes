import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyInto, fileExists } from "../util/fs";

/**
 * Brand fonts for the RENDERED video. HyperFrames renders in headless Chrome,
 * which has no project fonts installed — without embedded files every caption
 * and title falls back to the platform default (Helvetica on macOS, DejaVu on
 * Linux CI), making renders visually non-reproducible. The woff2 files live in
 * packages/core/assets/fonts and are copied into each composition's media dir;
 * page() emits matching @font-face rules.
 */

const FONT_FILES = [
  { file: "DMSans-Variable.woff2", family: "DM Sans", weights: "400 1000" },
  { file: "GeistMono-Variable.woff2", family: "Geist Mono", weights: "400 600" },
] as const;

/** Locate packages/core/assets/fonts from ANY runtime layout. Every strategy's
 *  result is VALIDATED by checking a real font file exists — bundlers lie.
 *  Turbopack in particular compiles `require.resolve` to return virtual
 *  `[project]/...` module ids that look like paths but aren't on disk, so the
 *  resolve result can never be trusted blind. Strategies, in order:
 *   1. node resolution of our own package.json (tsx, dist, webpack)
 *   2. walk up from this module's URL (plain node layouts)
 *   3. walk up from process.cwd() to the workspace root (Turbopack dev server,
 *      CLI run from anywhere inside the repo) */
function assetsFontsDir(): string | null {
  const probe = FONT_FILES[0].file;
  const candidates: string[] = [];

  try {
    const require = createRequire(import.meta.url);
    candidates.push(join(dirname(require.resolve("@podframes/core/package.json")), "assets", "fonts"));
  } catch {
    /* bundled runtimes may not support this */
  }

  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pkg = join(dir, "package.json");
      if (fileExists(pkg)) {
        try {
          const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name;
          if (name === "@podframes/core") candidates.push(join(dir, "assets", "fonts"));
        } catch {
          /* keep walking */
        }
      }
      dir = dirname(dir);
    }
  } catch {
    /* import.meta.url may not be a file: URL under some bundlers */
  }

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, "packages", "core", "assets", "fonts"));
    candidates.push(join(dir, "node_modules", "@podframes", "core", "assets", "fonts"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return candidates.find((c) => fileExists(join(c, probe))) ?? null;
}

export interface EmbeddedFont {
  family: string;
  weights: string;
  /** Composition-relative src. */
  src: string;
}

/** Copy the brand fonts into `destDir` (composition media/fonts). Missing asset
 *  files fail the compose loudly — a brandless render should never ship silently. */
export async function copyFonts(destDir: string): Promise<EmbeddedFont[]> {
  const srcDir = assetsFontsDir();
  if (!srcDir) throw new Error("could not locate @podframes/core/assets/fonts (package layout changed?)");
  const out: EmbeddedFont[] = [];
  for (const f of FONT_FILES) {
    const src = join(srcDir, f.file);
    if (!fileExists(src)) throw new Error(`brand font missing: ${src}`);
    await copyInto(src, destDir, f.file);
    out.push({ family: f.family, weights: f.weights, src: `media/fonts/${f.file}` });
  }
  return out;
}

/** @font-face rules for the composition page. */
export function fontFaceCss(fonts: EmbeddedFont[]): string {
  return fonts
    .map(
      (f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weights};src:url('${f.src}') format('woff2')}`,
    )
    .join("\n");
}
