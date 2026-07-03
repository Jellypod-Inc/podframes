import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { join, normalize, extname } from "node:path";
import { projectsDir } from "@/lib/root";

const toWeb = (s: ReturnType<typeof createReadStream>) =>
  Readable.toWeb(s) as unknown as ReadableStream<Uint8Array>;

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".html": "text/html",
};

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const root = projectsDir();
  const rel = normalize(path.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) return new Response("forbidden", { status: 403 });

  const file = join(root, rel);
  if (!file.startsWith(root) || !existsSync(file)) return new Response("not found", { status: 404 });

  const stat = statSync(file);
  if (stat.isDirectory()) return new Response("not found", { status: 404 });

  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Versioned URLs (?v=<stage finishedAt>) are immutable: the URL changes when
  // the artifact does, so the browser never refetches an unchanged clip.
  // Unversioned URLs stay uncached.
  const versioned = new URL(req.url).searchParams.has("v");
  const cacheControl = versioned ? "public, max-age=31536000, immutable" : "no-cache";
  const range = req.headers.get("range");

  // Range request (video seeking). Clamp untrusted bounds — createReadStream
  // throws synchronously on start > end or start beyond EOF.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0;
      const end = Math.min(match[2] ? Number.parseInt(match[2], 10) : stat.size - 1, stat.size - 1);
      if (!Number.isFinite(start) || start < 0 || start > end || start >= stat.size) {
        return new Response("invalid range", {
          status: 416,
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      const chunkSize = end - start + 1;
      return new Response(toWeb(createReadStream(file, { start, end })), {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
        },
      });
    }
  }

  return new Response(toWeb(createReadStream(file)), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
    },
  });
}
