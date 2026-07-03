import type { Script, ScriptTurn, Cue, Host, PipelineOptions, ClipAsset, TurnRegion } from "@podframes/core";
import type { ProjectDetail } from "@/lib/dto";

export type { ScriptTurn, Cue, Host, ClipAsset, TurnRegion };
/** The studio's project DTO is DERIVED from the server serializer (lib/dto) — one source of truth. */
export type { ProjectDetail };

export interface ClipTrimPatch {
  id: string;
  trimStartSec?: number;
  trimEndSec?: number;
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `${res.status}`);
  return res.json();
}

export const getProject = (slug: string): Promise<ProjectDetail> =>
  fetch(`/api/projects/${slug}`, { cache: "no-store" }).then(jsonOrThrow);

/** Permanently delete one project. */
export const deleteProject = (slug: string): Promise<{ ok: boolean }> =>
  fetch(`/api/projects/${slug}`, { method: "DELETE" }).then(jsonOrThrow);

export interface PatchBody {
  config?: Record<string, unknown>;
  hosts?: Host[];
  script?: Script;
  cues?: Cue[];
  options?: Partial<PipelineOptions>;
  clipTrims?: ClipTrimPatch[];
}

/** Create an empty project (no stages) and get its detail — used to lazily back Step-1 face actions. */
export const createProject = (config: Record<string, unknown>): Promise<ProjectDetail> =>
  fetch(`/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  }).then(jsonOrThrow);

/** PATCH also reports what it invalidated — the UI surfaces it, so a paid
 *  artifact can never silently vanish after an edit. */
export const patchProject = (
  slug: string,
  body: PatchBody,
): Promise<ProjectDetail & { cleared?: string[]; clearedTurns?: number[] }> =>
  fetch(`/api/projects/${slug}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(jsonOrThrow);

/** Upload a reference photo as one host's base face. */
export function uploadHostPhoto(slug: string, hostId: string, file: File): Promise<unknown> {
  const fd = new FormData();
  fd.append("hostId", hostId);
  fd.append("file", file);
  return fetch(`/api/projects/${slug}/cast`, { method: "POST", body: fd }).then(jsonOrThrow);
}

export const regenCueImage = (slug: string, cueId: string, imagePrompt?: string): Promise<{ imageUrl: string }> =>
  fetch(`/api/projects/${slug}/broll/${cueId}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePrompt }),
  }).then(jsonOrThrow);

/** Delete specific turns' lip-sync clips (keeps the rest cached) so the next
 *  generate({to:"video"}) re-animates only the ones you checked. */
export const regenerateClips = (slug: string, turnIndices: number[]): Promise<unknown> =>
  fetch(`/api/projects/${slug}/video/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnIndices }),
  }).then(jsonOrThrow);

export const mediaUrl = (slug: string, rel: string, v?: string | number) =>
  `/api/media/${slug}/${rel}${v != null ? `?v=${encodeURIComponent(String(v))}` : ""}`;

/** Synthesize a one-line voice sample; returns an object URL to play. */
export async function previewVoice(opts: {
  model: string;
  voice: string;
  stability?: number;
  style?: string;
  text?: string;
}): Promise<string> {
  const res = await fetch("/api/voice-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || "preview failed");
  return URL.createObjectURL(await res.blob());
}
