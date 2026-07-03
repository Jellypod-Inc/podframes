import { PROVIDER_COLORS, PROVIDER_COLOR_FALLBACK } from "@podframes/core/shared";

/** TTS providers Speechbase routes to, with their patch-bay channel colors. */
export interface ProviderMeta {
  id: string;
  label: string;
  color: string;
  /** Pickable models for the studio (a curated subset; the live catalog is larger). */
  models?: { id: string; label: string; voices: { id: string; label: string }[] }[];
}

// Full Gemini TTS prebuilt voice set (30) with their documented characteristic.
const GEMINI_VOICES = [
  ["Zephyr", "Bright"],
  ["Puck", "Upbeat"],
  ["Charon", "Informative"],
  ["Kore", "Firm"],
  ["Fenrir", "Excitable"],
  ["Leda", "Youthful"],
  ["Orus", "Firm"],
  ["Aoede", "Breezy"],
  ["Callirrhoe", "Easy-going"],
  ["Autonoe", "Bright"],
  ["Enceladus", "Breathy"],
  ["Iapetus", "Clear"],
  ["Umbriel", "Easy-going"],
  ["Algieba", "Smooth"],
  ["Despina", "Smooth"],
  ["Erinome", "Clear"],
  ["Algenib", "Gravelly"],
  ["Rasalgethi", "Informative"],
  ["Laomedeia", "Upbeat"],
  ["Achernar", "Soft"],
  ["Alnilam", "Firm"],
  ["Schedar", "Even"],
  ["Gacrux", "Mature"],
  ["Pulcherrima", "Forward"],
  ["Achird", "Friendly"],
  ["Zubenelgenubi", "Casual"],
  ["Vindemiatrix", "Gentle"],
  ["Sadachbia", "Lively"],
  ["Sadaltager", "Knowledgeable"],
  ["Sulafat", "Warm"],
].map(([id, trait]) => ({ id, label: `${id} · ${trait}` }));

// Studio is focused on Google (Gemini) + ElevenLabs for now; others are display-only
// chips (the homepage patch-bay still shows the broader Speechbase ecosystem).
// The 7 core patch-bay channels take their colors from @podframes/core/shared —
// the same constants the rendered video uses, so they can never drift.
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "google",
    label: "Google",
    color: PROVIDER_COLORS.google!,
    models: [{ id: "google/gemini-3.1-flash-tts-preview", label: "gemini-3.1-flash-tts", voices: GEMINI_VOICES }],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    color: PROVIDER_COLORS.elevenlabs!,
    models: [
      {
        id: "elevenlabs/eleven_v3",
        label: "eleven_v3",
        voices: [
          { id: "7QN34D2r3hCNwbOYIeK0", label: "Warren · effortless cool" },
          { id: "gOupLcAkjEnguROwi4oS", label: "Darian · warm storyteller" },
          { id: "AaOhDHYJ1XLZk74lXhdE", label: "Caleb · trusted guide" },
          { id: "ktkP7Nsj67dw2zcplQYt", label: "Lawrence · bright educator" },
          { id: "6WwXjDDEMyNmFG95zycZ", label: "Eldrin · British baritone" },
          { id: "fnYMz3F5gMEDGMWcH1ex", label: "Finley · articulate anchor" },
          { id: "FrS6cKLB1wg4WYgPa9GW", label: "Wyatt · seasoned mentor" },
          { id: "OZ0L6eISlOejga3XjDFt", label: "Talia · warm soft guide" },
          { id: "WQP7cQUF5aAS6Axh5yaa", label: "Elara · crisp pro narrator" },
          { id: "BFd5oBc2DDna33pSi4Gf", label: "Alicia · polished global anchor" },
          { id: "QtY3JBOUKEB5xzrRfOKc", label: "Maisie · friendly casual neighbor" },
          { id: "dvbL7qkNGZY1IqPGZAjM", label: "Elowen · upbeat modern narrator" },
          { id: "22N9cF8z0o7y23njdyaY", label: "Florence · atmospheric storyteller" },
          { id: "g7LVvkPWALzPxOQbF6OE", label: "Jade · upbeat natural" },
        ],
      },
    ],
  },
  // Display-only (not pickable in the studio for now).
  { id: "openai", label: "OpenAI", color: PROVIDER_COLORS.openai! },
  { id: "cartesia", label: "Cartesia", color: PROVIDER_COLORS.cartesia! },
  { id: "hume", label: "Hume", color: PROVIDER_COLORS.hume! },
  { id: "inworld", label: "Inworld", color: PROVIDER_COLORS.inworld! },
  { id: "deepgram", label: "Deepgram", color: PROVIDER_COLORS.deepgram! },
  { id: "fish", label: "Fish Audio", color: "#60A5FA" },
  { id: "murf", label: "Murf", color: "#F472B6" },
  { id: "resemble", label: "Resemble", color: "#818CF8" },
  { id: "smallest", label: "Smallest AI", color: "#4ADE80" },
  { id: "fal", label: "fal", color: "#E879F9" },
  { id: "mistral", label: "Mistral", color: "#FB923C" },
  { id: "xai", label: "xAI", color: "#94A3B8" },
  { id: "minimax", label: "MiniMax", color: "#2DD4BF" },
];

export const PICKABLE_PROVIDERS = PROVIDERS.filter((p) => p.models?.length);

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerColor(id: string): string {
  return providerById(id)?.color ?? PROVIDER_COLOR_FALLBACK;
}

export function providerOfModel(model: string): string {
  const i = model.indexOf("/");
  return i > 0 ? model.slice(0, i) : "unknown";
}
