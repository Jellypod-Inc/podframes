/** Quick-pick host presets. Portraits are static assets at /roster/<key>.png. */
export interface RosterPreset {
  key: string;
  name: string;
  provider: string;
  voice?: string;
  appearance: string;
}

export const ROSTER: RosterPreset[] = [
  {
    key: "ada",
    name: "Ada",
    provider: "google",
    voice: "Aoede",
    appearance:
      "East Asian woman in her early 30s, sleek straight black shoulder-length hair, light warm skin, olive blazer over a white tee, friendly expressive face",
  },
  {
    key: "ren",
    name: "Ren",
    provider: "elevenlabs",
    appearance:
      "East Asian man in his early 30s, modern undercut hairstyle, light skin, black bomber jacket, cool and composed",
  },
  {
    key: "sol",
    name: "Sol",
    provider: "google",
    appearance:
      "Latino man in his mid-30s, short dark wavy hair, trimmed beard, warm olive skin, denim shirt, relaxed grin",
  },
  {
    key: "theo",
    name: "Theo",
    provider: "elevenlabs",
    voice: "7QN34D2r3hCNwbOYIeK0",
    appearance:
      "white man in his late 30s, light stubble, glasses, fair skin, charcoal henley, animated demeanor",
  },
  {
    key: "maya",
    name: "Maya",
    provider: "elevenlabs",
    appearance:
      "Black woman in her early 30s, voluminous natural curls, warm brown skin, mustard turtleneck, expressive",
  },
  {
    key: "nia",
    name: "Nia",
    provider: "google",
    appearance:
      "South Asian woman in her late 20s, long dark wavy hair, brown skin, emerald green blouse, thoughtful",
  },
];

export const rosterThumb = (key: string) => `/roster/${key}.png`;
