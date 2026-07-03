/**
 * Capture studio-wizard screenshots for the launch video's UI walkthrough scene.
 *
 *   pnpm tsx scripts/studio-shots.mts   # needs the web studio running on :3021
 *
 * Writes projects/_launch/ui/step-{1..4}.png (1920×1080 @2x). Step 1 is the
 * blank new-video wizard; steps 2–4 open the finished meta-demo project so the
 * script editor, per-turn clips, and caption controls show real data.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "projects", "_launch", "ui");
const BASE = "http://localhost:3021";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const require = createRequire(
  join(ROOT, "node_modules", ".pnpm", "puppeteer-core@24.43.1", "node_modules", "puppeteer-core", "package.json"),
);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require(join(ROOT, "node_modules", ".pnpm", "puppeteer-core@24.43.1", "node_modules", "puppeteer-core"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();

  // Hide Next.js dev-tools UI in every shot.
  const hideDevUi = () =>
    page.addStyleTag({
      content: "nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }",
    });

  async function shot(name: string, url: string | null, clickText?: string): Promise<void> {
    if (url) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0", timeout: 60000 });
      await hideDevUi();
    }
    if (clickText) {
      const clicked = await page.evaluate((text: string) => {
        const els = [...document.querySelectorAll("button, a, [role='tab'], [class*='step']")];
        const el = els.find((e) => (e.textContent ?? "").trim().toLowerCase().includes(text.toLowerCase()));
        if (el instanceof HTMLElement) { el.click(); return true; }
        return false;
      }, clickText);
      if (!clicked) console.warn(`  ! could not find clickable "${clickText}"`);
      await sleep(1800); // settle: step transition, media, fonts
    }
    await sleep(1200);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}.png`);
  }

  console.log("capturing studio wizard shots…");
  await shot("step-1", "/studio?slug=demo-meet-podframes", "Cast & voice"); // faces + voices, populated
  await shot("step-2", null, "Script");                                     // script editor, per-line costs
  await shot("step-3", null, "Videos");                                     // per-turn clips + estimate
  await shot("step-4", null, "B-roll & captions");                          // caption styles + live preview
  await shot("step-5", null, "Output");                                     // render step
  await browser.close();
  console.log(`✓ shots → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
