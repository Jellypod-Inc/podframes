import { ROSTER, rosterThumb } from "@/lib/roster";
import { providerOfModel } from "@/lib/providers";
import { defaultChannel, channelToHost } from "@/components/studio/host-channel";
import { mediaUrl, type ProjectDetail, type Host } from "@/components/studio/api";
import type { Channel } from "@/components/studio/controls-types";

/** A cast channel is the host-editor model + raw provider params + the roster portrait it was picked from. */
export type CastChannel = Channel & { rosterKey?: string; stability?: number; style?: string; flip?: boolean };

/** Map cast channels → pipeline Hosts, carrying the raw provider params + flip through. */
export function castToHosts(cast: CastChannel[]): Host[] {
  return cast.map((c) => ({
    ...channelToHost(c),
    ...(c.rosterKey ? { avatarKey: c.rosterKey } : {}),
    ...(c.stability != null ? { defaultStability: c.stability } : {}),
    ...(c.style ? { defaultStyle: c.style } : {}),
    ...(c.flip ? { flip: true } : {}),
  }));
}

export type Aspect = "16:9" | "9:16";

/** The product's de-facto default cast. */
export function defaultCast(): CastChannel[] {
  const ada = rosterPreset("ada");
  const theo = rosterPreset("theo");
  return [
    { ...defaultChannel("host_a", "left", ada.name, ada.provider, ada.appearance, ada.voice), rosterKey: ada.key },
    { ...defaultChannel("host_b", "right", theo.name, theo.provider, theo.appearance, theo.voice), rosterKey: theo.key },
  ];
}

function rosterPreset(key: string) {
  const preset = ROSTER.find((r) => r.key === key);
  if (!preset) throw new Error(`missing roster preset: ${key}`);
  return preset;
}

/** Re-seed the cast editor from a saved project's hosts. */
export function castFromHosts(hosts: Host[]): CastChannel[] {
  return hosts.map((h) => ({
    id: h.id,
    name: h.name,
    side: h.side,
    model: h.model,
    voice: h.voice,
    provider: providerOfModel(h.model),
    appearance: h.appearance ?? "",
    persona: h.persona,
    stability: h.defaultStability,
    style: h.defaultStyle,
    flip: h.flip,
    rosterKey: h.avatarKey,
  }));
}

/** Build the full ConversationConfig used to CREATE a project (sane defaults fill the rest). */
export function configFrom(
  cast: CastChannel[],
  topic: string,
  style: string,
  aspect: Aspect,
  resolution: "720p" | "1080p" = "720p",
): CreateConfig {
  return {
    topic: topic.trim(),
    styleNote: style.trim() || "snappy and punchy — a fun, fast back-and-forth",
    maxWordsPerTurn: 16,
    aspectRatio: aspect,
    hosts: castToHosts(cast),
    options: { captionStyle: "clean", videoResolution: resolution },
  };
}

export type CreateConfig = {
  topic: string;
  styleNote: string;
  maxWordsPerTurn: number;
  aspectRatio: Aspect;
  hosts: Host[];
  options: Record<string, unknown>;
};

/**
 * The face to show for a host in the preview, in priority order:
 *   current base still/upload → roster portrait (the pick) → none (provider-color placeholder).
 */
export function hostFace(project: ProjectDetail | null, slug: string | null, ch: CastChannel): string | undefined {
  const avatar = project?.stills?.hosts[ch.id]?.imagePath;
  if (avatar && slug) return mediaUrl(slug, avatar, project?.updatedAt);
  // An uploaded/base avatar shows immediately, before the stills stage has run.
  const uploaded = project?.uploads?.[ch.id];
  if (uploaded && slug) return mediaUrl(slug, uploaded, project?.updatedAt);
  if (ch.rosterKey) return rosterThumb(ch.rosterKey);
  return undefined;
}
