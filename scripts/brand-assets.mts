/**
 * Generate the repo's brand assets with Nano Banana 2 (one-off, committed):
 *
 *   .github/assets/banner.png   — README hero (16:9)
 *   .github/assets/social.png   — GitHub social preview (2:1 crop of the banner;
 *                                 upload in repo Settings → Social preview)
 *   apps/web/app/icon.png       — app icon / favicon source (1:1)
 *
 * Run: pnpm exec tsx scripts/brand-assets.mts [--only banner,icon]
 * Then: npx favipack apps/web/app/icon.png (favicon pack, if you want .ico)
 *
 * Brand rules (design.md): warm stone-charcoal #100F0E canvas — never cool
 * blue-black — electric cyan #22D3EE signal, square/sharp, patch-bay motif.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { GeminiClient, resolveEnv } from "@podframes/core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1]!.split(","))
  : null;

const env = resolveEnv(root);
if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY missing (.env.local)");
const gemini = new GeminiClient({ apiKey: env.geminiApiKey });

const BRAND_LOOK =
  "Color palette: deep warm stone-charcoal background (#100F0E, warm near-black — NEVER cool blue-black), " +
  "electric cyan (#22D3EE) as the single glowing accent, subtle warm off-white highlights. " +
  "Aesthetic: premium, editorial, production-grade, sharp square corners, thin 1px hairline lines, " +
  "moody cinematic studio lighting.";

const ASSETS: Array<{ key: string; out: string; aspect: string; size: "1K" | "2K"; prompt: string }> = [
  {
    key: "banner",
    out: ".github/assets/banner.png",
    aspect: "16:9",
    size: "2K",
    prompt: [
      "Wide hero banner for an open-source developer tool called podframes.",
      "Scene: a modern podcast studio, two AI hosts (an East Asian woman with sleek black hair in an olive",
      "blazer on the left, a man with light stubble and glasses in a charcoal henley on the right) seated at",
      "broadcast microphones facing each other, mid-conversation. Between and beneath them, a studio patch",
      "bay: several colored patch cables (cyan, violet, blue, green) routing from separate input jacks and",
      "merging into ONE glowing cyan output cable — the visual metaphor of many voices mixed into one track.",
      "Large clean lowercase wordmark text \"podframes\" in a bold modern sans-serif, warm off-white with the",
      "letters 'pod' in electric cyan, centered in the upper third. Below it a small thin tagline:",
      "\"turn a topic into a podcast you can watch\".",
      BRAND_LOOK,
      "Composition: dark, lots of negative space, the wordmark crisp and perfectly legible.",
    ].join(" "),
  },
  {
    key: "icon",
    out: "apps/web/app/icon.png",
    aspect: "1:1",
    size: "1K",
    prompt: [
      "Minimal flat app icon on a solid deep warm charcoal background (#100F0E).",
      "A single glowing electric-cyan (#22D3EE) audio patch cable, drawn as one clean continuous rounded",
      "line, whose loop and stem form a lowercase letter 'p'. The cable ends in a small cyan jack plug.",
      "Subtle cyan glow, sharp square canvas, flat vector style, perfectly centered, generous margins.",
      "No other text, no letters besides the p-shape, no gradients in the background.",
    ].join(" "),
  },
];

const outDir = resolve(root, ".github", "assets");
await mkdir(outDir, { recursive: true });

for (const a of ASSETS) {
  if (only && !only.has(a.key)) continue;
  const outPath = resolve(root, a.out);
  console.log(`→ ${a.key} (${a.aspect}, ${a.size}) → ${a.out}`);
  await gemini.generateImageToFile({
    model: "gemini-3.1-flash-image",
    prompt: a.prompt,
    aspectRatio: a.aspect,
    imageSize: a.size,
    outputPath: outPath,
  });
}
console.log("done — crop social.png with: ffmpeg -i .github/assets/banner.png -vf \"crop=iw:ih*9/16*8/9\" ...");
