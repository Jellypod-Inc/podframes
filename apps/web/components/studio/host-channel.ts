import { providerById } from "@/lib/providers";
import type { Host } from "@podframes/core";
import type { Channel } from "./controls-types";

/** A host editor channel seeded with the provider's first model and default/overridden voice. */
export function defaultChannel(
  id: string,
  side: "left" | "right",
  name: string,
  provider: string,
  appearance: string,
  voice?: string,
): Channel {
  const p = providerById(provider);
  const m = p?.models?.[0];
  return { id, side, name, provider, model: m?.id ?? "", voice: voice ?? m?.voices[0]?.id ?? "", appearance };
}

export const channelToHost = (c: Channel): Host => ({
  id: c.id,
  name: c.name,
  speaker: c.id === "host_a" ? "HOST_A" : "HOST_B",
  model: c.model,
  voice: c.voice,
  side: c.side,
  appearance: c.appearance,
  // Carried through even though the studio has no persona editor — dropping it
  // would read as "persona changed" server-side and invalidate the whole script.
  ...(c.persona !== undefined ? { persona: c.persona } : {}),
});
