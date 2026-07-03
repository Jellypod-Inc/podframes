import { resolveEnv } from "@podframes/core";
import { exec } from "node:child_process";
import { findRepoRoot } from "@/lib/root";

export const runtime = "nodejs";

/** Which keys/binaries are configured — the studio header renders these as dots
 *  so misconfiguration is visible up-front, not one stage-failure at a time. */
export async function GET() {
  const env = resolveEnv(findRepoRoot());
  const ffmpeg = await new Promise<boolean>((resolve) => {
    exec("ffmpeg -version", (err) => resolve(!err));
  });
  return Response.json({
    speechbase: !!env.speechbaseApiKey,
    gemini: !!env.geminiApiKey,
    fal: !!env.falApiKey,
    replicate: !!env.replicateApiKey,
    ffmpeg,
  });
}
