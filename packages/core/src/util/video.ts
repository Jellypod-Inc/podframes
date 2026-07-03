import { dirname } from "node:path";
import { ensureDir } from "./fs";
import { run } from "./proc";

/** Slice a video into a fresh, muted MP4 for composition use. The original paid clip stays untouched. */
export async function trimVideo(
  input: string,
  output: string,
  trimStartSec: number,
  trimEndSec: number,
  inputDurationSec: number,
): Promise<string> {
  const start = Math.max(0, trimStartSec);
  const duration = Math.max(0.1, inputDurationSec - start - Math.max(0, trimEndSec));
  await ensureDir(dirname(output));
  await run("ffmpeg", [
    "-y",
    "-ss",
    start.toFixed(3),
    "-i",
    input,
    "-t",
    duration.toFixed(3),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    output,
  ]);
  return output;
}
