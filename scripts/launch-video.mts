/**
 * podframes launch video v2 — snappier cut of the 3 launch demos + Lyria techno bed.
 *
 *   pnpm tsx scripts/launch-video.mts            # build + render both music variants
 *   pnpm tsx scripts/launch-video.mts html       # write composition only, no render
 *
 * Timeline (~48s, hard cuts on the beat, avatars alternate Theo/Ada/Maya):
 *   00.0–04.8  hook          — Theo: "One single line of input generated both of us right this second."
 *   04.8–06.1  brand stinger — podframes wordmark flash
 *   06.1–13.4  intro         — Ada: "an open-source tool that turns one sentence into a video"
 *   13.4–18.4  terminal      — command types fast, stages check off (p-video | ltx-2.3)
 *   18.4–23.0  cost payoff   — 9:16 card, the $2 receipt (the topic the terminal just typed)
 *   23.0–30.0  speechbase    — Theo: "my ElevenLabs voice + your Google voice" + provider-mix overlay
 *   30.0–36.4  local/BYOK    — Ada: "we only exist locally on someone's machine using their personal API keys"
 *   36.4–41.2  closer        — Theo: "Type any topic into your terminal…"
 *   41.2–47.5  end card      — icon, tagline, repo, Apache-2.0 / local / BYOK
 *
 * Music runs from second zero (ducked under speech, up for stinger/terminal/end).
 * Outputs land in projects/_launch/video/ (gitignored). Renders with --workers 1
 * (multi-worker capture crops 87px), remuxes with -ignore_editlist, excerpts use -bf 0.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCH = join(ROOT, "projects", "_launch", "video");
const COMP = join(LAUNCH, "composition");
const MEDIA = join(COMP, "media");
const HYPERFRAMES = join(ROOT, "packages", "core", "node_modules", ".bin", "hyperframes");
const FONTS_SRC = join(ROOT, "packages", "core", "assets", "fonts");

const W = 1920, H = 1080, FPS = 30;

// design.md tokens (packages/core/src/shared.ts BRAND + provider colors)
const C = {
  bg: "#100F0E", surface: "#181715", surface2: "#201E1B", hairline: "#2F2B27",
  text: "#F4F2EC", text2: "#A8A298", muted: "#857C6F",
  accent: "#22D3EE", blue: "#5B8CFF", success: "#34D399", purple: "#A78BFA",
};

// ── Cut list — each cut is one spoken turn, timed from the project's speech
// state so line edits / re-synths never desync the excerpts. ──────────────────
interface Cut { id: string; project: string; turn: number; from: number; to: number }
const CUT_SPECS: Array<Omit<Cut, "from" | "to">> = [
  { id: "hook",  project: "demo-meet-podframes", turn: 5 }, // Theo — "this entire show was generated…"
  { id: "intro", project: "demo-meet-podframes", turn: 0 }, // Ada
  { id: "cost",  project: "demo-what-this-cost", turn: 3 }, // Maya — "$2, full episode under ten"
  { id: "sbase", project: "demo-meet-podframes", turn: 3 }, // Theo — the Speechbase line
  { id: "keys",  project: "demo-meet-podframes", turn: 6 }, // Ada — local + BYO keys
  { id: "heroC", project: "demo-meet-podframes", turn: 9 }, // Theo — "type any topic…"
];
const CUTS: Cut[] = CUT_SPECS.map((spec) => {
  const state = JSON.parse(readFileSync(join(ROOT, "projects", spec.project, "project.json"), "utf8")) as {
    speech: { turns: Array<{ turnIndex: number; start: number; end: number; text: string }> };
  };
  const turn = state.speech.turns.find((t) => t.turnIndex === spec.turn);
  if (!turn) throw new Error(`${spec.project} has no speech turn ${spec.turn}`);
  return { ...spec, from: turn.start, to: turn.end };
});
const dur = (id: string) => { const c = CUTS.find((c) => c.id === id)!; return c.to - c.from; };

// ── Scene windows ──────────────────────────────────────────────────────────────
const T_HOOK = 0;
const T_STING = T_HOOK + dur("hook");        // 4.76
const STING_DUR = 1.34;
const T_INTRO = T_STING + STING_DUR;         // 6.10
const T_TERM = T_INTRO + dur("intro");       // 13.36
const TERM_DUR = 5.0;
const T_UI = T_TERM + TERM_DUR;              // "…or click through the studio" walkthrough
const UI_SHOTS = 4;                          // cast & voice → script → videos → captions
const UI_SHOT_DUR = 1.9;
const UI_DUR = UI_SHOTS * UI_SHOT_DUR;       // 7.6
const T_COST = T_UI + UI_DUR;
const T_SBASE = T_COST + dur("cost");        // 22.95
const T_KEYS = T_SBASE + dur("sbase");       // 29.95
const T_HERO_C = T_KEYS + dur("keys");       // 36.37
const T_END = T_HERO_C + dur("heroC");       // 41.21
const END_DUR = 6.29;
const TOTAL = T_END + END_DUR;               // 47.50

const r2 = (n: number) => Math.round(n * 100) / 100;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ff(args: string[]): void {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
}

// ── Media prep ─────────────────────────────────────────────────────────────────
function prepMedia(): void {
  mkdirSync(join(MEDIA, "fonts"), { recursive: true });
  for (const f of ["DMSans-Variable.woff2", "GeistMono-Variable.woff2"])
    copyFileSync(join(FONTS_SRC, f), join(MEDIA, "fonts", f));
  copyFileSync(join(ROOT, ".github", "assets", "icon.png"), join(MEDIA, "icon.png"));
  for (let i = 1; i <= UI_SHOTS; i++)
    copyFileSync(join(ROOT, "projects", "_launch", "ui", `step-${i}.png`), join(MEDIA, `ui-${i}.png`));

  for (const c of CUTS) {
    const src = join(ROOT, "projects", c.project, "output.mp4");
    if (!existsSync(src)) throw new Error(`missing demo output: ${src} — run scripts/launch-demos.mts first`);
    const v = join(MEDIA, `${c.id}.mp4`);
    const a = join(MEDIA, `${c.id}.mp3`);
    if (!existsSync(v))
      ff(["-i", src, "-ss", String(c.from), "-to", String(c.to),
          "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-bf", "0", "-pix_fmt", "yuv420p", v]);
    if (!existsSync(a))
      ff(["-i", src, "-ss", String(c.from), "-to", String(c.to), "-vn", "-c:a", "libmp3lame", "-q:a", "2", a]);
  }
}

// ── Composition HTML ───────────────────────────────────────────────────────────
function timedVideo(id: string, cls: string, start: number, duration: number): string {
  return `    <video id="${id}" class="${cls}" src="media/${id}.mp4" muted playsinline crossorigin="anonymous" data-start="${r2(start)}" data-duration="${r2(duration)}" data-track-index="0"></video>`;
}
function timedAudio(id: string, start: number, duration: number): string {
  return `    <audio id="a-${id}" src="media/${id}.mp3" data-start="${r2(start)}" data-duration="${r2(duration)}" data-track-index="5" data-volume="1"></audio>`;
}
function overlay(id: string, cls: string, start: number, duration: number, inner: string): string {
  return `    <div id="${id}" class="clip overlay ${cls}" data-start="${r2(start)}" data-duration="${r2(duration)}" data-track-index="12" style="opacity:0">\n${inner}\n    </div>`;
}

function buildHtml(): string {
  const videos = [
    timedVideo("hook", "full", T_HOOK, dur("hook")),
    timedVideo("intro", "full", T_INTRO, dur("intro")),
    timedVideo("cost", "phone", T_COST, dur("cost")),
    timedVideo("sbase", "full", T_SBASE, dur("sbase")),
    timedVideo("keys", "full", T_KEYS, dur("keys")),
    timedVideo("heroC", "full", T_HERO_C, dur("heroC")),
  ].join("\n");

  const audios = [
    timedAudio("hook", T_HOOK, dur("hook")),
    timedAudio("intro", T_INTRO, dur("intro")),
    timedAudio("cost", T_COST, dur("cost")),
    timedAudio("sbase", T_SBASE, dur("sbase")),
    timedAudio("keys", T_KEYS, dur("keys")),
    timedAudio("heroC", T_HERO_C, dur("heroC")),
  ].join("\n");

  // Brand stinger — one-beat wordmark flash between hook and terminal.
  const stingInner = `      <div class="sting">
        <div class="sting-name">podframes</div>
        <div class="sting-tag">one topic → a show you can watch</div>
      </div>`;

  // Terminal — command types fast, five stages check off.
  const cmd = `pnpm podframes generate --topic "how much did this video cost?"`;
  const cmdSpans = [...cmd].map((ch) => `<span class="tc">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");
  const stages = [
    ["script", "gemini-3.1-pro"],
    ["speech", "speechbase mix · word timestamps"],
    ["avatars", "nano banana 2"],
    ["lip-sync", "p-video | ltx-2.3"],
    ["render", "output.mp4 · captioned"],
  ];
  const stageLines = stages
    .map(([k, v], i) => `        <div class="tl-line" id="tl-${i}"><span class="tl-check">✓</span><span class="tl-stage">${k}</span><span class="tl-note">${v}</span></div>`)
    .join("\n");
  const termInner = `      <div class="term">
        <div class="term-bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="term-title">podframes</span></div>
        <div class="term-body">
          <div class="term-cmd"><span class="prompt">$&nbsp;</span>${cmdSpans}<span class="cursor" id="cursor">▋</span></div>
${stageLines}
        </div>
      </div>`;

  const costLabel = `      <div class="side left">
        <div class="side-big">type a topic.<br/>get the show.</div>
        <div class="side-mono">--topic "how much did<br/>this video cost?"</div>
      </div>
      <div class="side right">
        <div class="side-sub">9:16 or 16:9 · lip-synced avatars<br/>word-timed captions · $2 receipt</div>
      </div>`;

  // Local/BYOK reinforcement chip over Ada's "we only exist locally" line.
  const keysInner = `      <div class="mix">
        <div class="mix-chip" id="ky-0" style="--ch:${C.accent}"><span class="mix-dot"></span>runs locally · bring your own keys</div>
      </div>`;

  // Speechbase beat — compact provider-mix panel, top-right over the 16:9 clip.
  const sbaseInner = `      <div class="mix">
        <div class="mix-chip" id="mx-0" style="--ch:${C.blue}"><span class="mix-dot"></span>Ada · google gemini-tts</div>
        <div class="mix-chip" id="mx-1" style="--ch:${C.purple}"><span class="mix-dot"></span>Theo · elevenlabs eleven_v3</div>
        <div class="mix-line" id="mx-2">→ one conversation, mixed by <b>Speechbase</b></div>
      </div>`;

  const endInner = `      <div class="end">
        <img class="end-icon" src="media/icon.png" alt="" crossorigin="anonymous" />
        <div class="end-name">podframes</div>
        <div class="end-tag">turn a topic into a podcast you can watch</div>
        <div class="end-repo">github.com/Jellypod-Inc/podframes</div>
        <div class="end-sub">open source · Apache-2.0 · runs on your machine · bring your own keys</div>
      </div>`;

  // Studio walkthrough — one shot per wizard step, CLI-or-UI story.
  const uiShots = Array.from({ length: UI_SHOTS }, (_, i) =>
    overlay(
      `ui-${i + 1}`,
      "ui-wrap",
      T_UI + i * UI_SHOT_DUR,
      UI_SHOT_DUR,
      `      <img class="ui-shot" src="media/ui-${i + 1}.png" crossorigin="anonymous" alt="" />`,
    ),
  ).join("\n");
  const uiLabel = `      <div class="ui-label"><span class="ui-or">…or click through</span> the studio</div>`;

  const overlays = [
    overlay("scene-sting", "sting-wrap", T_STING, STING_DUR, stingInner),
    overlay("scene-term", "term-wrap", T_TERM, TERM_DUR, termInner),
    uiShots,
    overlay("ui-head", "ui-head-wrap", T_UI, UI_DUR, uiLabel),
    overlay("lab-cost", "labels", T_COST, dur("cost"), costLabel),
    overlay("lab-sbase", "mix-wrap", T_SBASE, dur("sbase"), sbaseInner),
    overlay("lab-keys", "mix-wrap", T_KEYS, dur("keys"), keysInner),
    overlay("scene-end", "end-wrap", T_END, END_DUR, endInner),
  ].join("\n");

  // ── GSAP timeline ──
  const tl: string[] = [];
  const fadeIn = (sel: string, at: number, d = 0.3) =>
    tl.push(`    tl.fromTo('${sel}', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: ${d}, ease: 'expo.out' }, ${r2(at)});`);
  const kill = (sel: string, at: number, d = 0.2) => {
    tl.push(`    tl.to('${sel}', { opacity: 0, duration: ${d}, ease: 'power2.in' }, ${r2(at - d)});`);
    tl.push(`    tl.set('${sel}', { opacity: 0 }, ${r2(at)});`);
  };

  // Stinger: hard pop on the beat, quick out.
  tl.push(`    tl.set('#scene-sting', { opacity: 1 }, ${r2(T_STING)});`);
  tl.push(`    tl.fromTo('#scene-sting .sting-name', { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 0.22, ease: 'back.out(2.4)' }, ${r2(T_STING)});`);
  tl.push(`    tl.fromTo('#scene-sting .sting-tag', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power3.out' }, ${r2(T_STING + 0.18)});`);
  kill("#scene-sting", T_STING + STING_DUR, 0.15);

  // Terminal: fast type-on, stages rapid-fire.
  fadeIn("#scene-term", T_TERM, 0.2);
  tl.push(`    tl.to('#scene-term .tc', { opacity: 1, duration: 0.015, stagger: 0.016 }, ${r2(T_TERM + 0.25)});`);
  const typeEnd = T_TERM + 0.25 + cmd.length * 0.016;
  stages.forEach((_, i) =>
    tl.push(`    tl.fromTo('#tl-${i}', { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.16, ease: 'power3.out' }, ${r2(typeEnd + 0.2 + i * 0.3)});`),
  );
  tl.push(`    tl.fromTo('#cursor', { opacity: 1 }, { opacity: 0, duration: 0.01, repeat: ${Math.floor(TERM_DUR / 0.45)}, repeatDelay: 0.45, yoyo: true }, ${r2(T_TERM + 0.2)});`);
  kill("#scene-term", T_TERM + TERM_DUR, 0.18);

  // Studio walkthrough: label holds, each shot slides through.
  tl.push(`    tl.set('#ui-head', { opacity: 1 }, ${r2(T_UI)});`);
  fadeIn("#ui-head .ui-label", T_UI + 0.1, 0.3);
  kill("#ui-head", T_UI + UI_DUR, 0.18);
  for (let i = 0; i < UI_SHOTS; i++) {
    const at = T_UI + i * UI_SHOT_DUR;
    tl.push(`    tl.set('#ui-${i + 1}', { opacity: 1 }, ${r2(at)});`);
    tl.push(`    tl.fromTo('#ui-${i + 1} .ui-shot', { opacity: 0, x: 46 }, { opacity: 1, x: 0, duration: 0.3, ease: 'expo.out' }, ${r2(at)});`);
    if (i < UI_SHOTS - 1)
      tl.push(`    tl.to('#ui-${i + 1} .ui-shot', { opacity: 0, x: -30, duration: 0.18, ease: 'power2.in' }, ${r2(at + UI_SHOT_DUR - 0.18)});`);
    else tl.push(`    tl.to('#ui-${i + 1} .ui-shot', { opacity: 0, duration: 0.18, ease: 'power2.in' }, ${r2(at + UI_SHOT_DUR - 0.18)});`);
    tl.push(`    tl.set('#ui-${i + 1}', { opacity: 0 }, ${r2(at + UI_SHOT_DUR)});`);
  }

  // Demo scene labels (wrapper visible + children animate).
  tl.push(`    tl.set('#lab-cost', { opacity: 1 }, ${r2(T_COST)});`);
  fadeIn("#lab-cost .left", T_COST + 0.3, 0.35);
  fadeIn("#lab-cost .right", T_COST + 0.55, 0.35);
  kill("#lab-cost", T_COST + dur("cost"));

  // Speechbase mix panel: chips land as the line is spoken.
  tl.push(`    tl.set('#lab-sbase', { opacity: 1 }, ${r2(T_SBASE)});`);
  fadeIn("#mx-0", T_SBASE + 0.5, 0.3);
  fadeIn("#mx-1", T_SBASE + 1.0, 0.3);
  fadeIn("#mx-2", T_SBASE + 1.9, 0.35);
  kill("#lab-sbase", T_SBASE + dur("sbase"));

  // Local/BYOK chip while Ada says it.
  tl.push(`    tl.set('#lab-keys', { opacity: 1 }, ${r2(T_KEYS)});`);
  fadeIn("#ky-0", T_KEYS + 0.8, 0.3);
  kill("#lab-keys", T_KEYS + dur("keys"));

  // End card: everything lands within ~1.2s, then holds.
  tl.push(`    tl.set('#scene-end', { opacity: 1 }, ${r2(T_END)});`);
  tl.push(`    tl.fromTo('#scene-end .end-icon', { opacity: 0, scale: 0.85, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'back.out(1.8)' }, ${r2(T_END + 0.1)});`);
  fadeIn("#scene-end .end-name", T_END + 0.3, 0.3);
  fadeIn("#scene-end .end-tag", T_END + 0.5, 0.3);
  fadeIn("#scene-end .end-repo", T_END + 0.8, 0.3);
  fadeIn("#scene-end .end-sub", T_END + 1.0, 0.3);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
@font-face{font-family:'DM Sans';src:url('media/fonts/DMSans-Variable.woff2') format('woff2');font-weight:400 1000;font-display:block}
@font-face{font-family:'Geist Mono';src:url('media/fonts/GeistMono-Variable.woff2') format('woff2');font-weight:400 600;font-display:block}
:root{--bg:${C.bg};--surface:${C.surface};--surface-2:${C.surface2};--hairline:${C.hairline};
  --text:${C.text};--text-2:${C.text2};--muted:${C.muted};--accent:${C.accent};--blue:${C.blue};--success:${C.success}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;background:#000;overflow:hidden;font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
#root{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:var(--bg)}
video.full{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:2}
video.phone{position:absolute;left:${(W - 496) / 2}px;top:${(H - 882) / 2}px;width:496px;height:882px;object-fit:cover;z-index:2;
  border:1px solid var(--hairline);box-shadow:0 40px 120px rgba(0,0,0,.6)}
.overlay{position:absolute;inset:0;pointer-events:none}
.sting-wrap{z-index:10;display:grid;place-items:center;background:var(--bg)}
.sting{text-align:center}
.sting-name{font-size:150px;font-weight:800;color:var(--text);letter-spacing:-.03em}
.sting-tag{font-family:'Geist Mono',monospace;font-size:32px;color:var(--accent);margin-top:10px}
.ui-wrap{z-index:10;display:grid;place-items:center;padding-top:44px}
.ui-shot{width:1680px;border:1px solid var(--hairline);box-shadow:0 40px 120px rgba(0,0,0,.6)}
.ui-head-wrap{z-index:11}
.ui-label{position:absolute;top:44px;left:0;right:0;text-align:center;font-size:34px;font-weight:700;color:var(--text);opacity:0}
.ui-label .ui-or{font-family:'Geist Mono',monospace;font-weight:400;font-size:30px;color:var(--accent)}
.term-wrap{z-index:10;display:grid;place-items:center}
.term{width:1250px;background:var(--surface);border:1px solid var(--hairline);box-shadow:0 40px 120px rgba(0,0,0,.55)}
.term-bar{display:flex;align-items:center;gap:12px;padding:18px 24px;border-bottom:1px solid var(--hairline);background:var(--surface-2)}
.term-bar .dot{width:14px;height:14px;border-radius:50%;background:var(--hairline)}
.term-title{margin-left:12px;font-family:'Geist Mono',monospace;font-size:22px;color:var(--muted)}
.term-body{padding:32px 40px 36px;font-family:'Geist Mono',monospace;font-size:30px;line-height:1.5}
.term-cmd{color:var(--text);margin-bottom:22px;word-break:break-all}
.prompt{color:var(--accent)}
.tc{opacity:0}
.cursor{color:var(--accent)}
.tl-line{display:flex;gap:18px;align-items:baseline;margin-top:8px;font-size:26px;opacity:0}
.tl-check{color:var(--success);font-weight:600}
.tl-stage{color:var(--text);min-width:170px}
.tl-note{color:var(--muted);font-size:23px}
.labels{z-index:10}
.side{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:20px;opacity:0}
.side.left{left:120px;width:${(W - 496) / 2 - 170}px;align-items:flex-start;text-align:left}
.side.right{right:120px;width:${(W - 496) / 2 - 170}px;align-items:flex-end;text-align:right}
.side-big{font-size:54px;font-weight:800;color:var(--text);line-height:1.12}
.side-mono{font-family:'Geist Mono',monospace;font-size:24px;color:var(--accent);line-height:1.5}
.side-sub{font-size:24px;color:var(--text-2);line-height:1.6}
.mix-wrap{z-index:10;display:flex;justify-content:flex-end;align-items:flex-start;padding:56px 64px}
.mix{display:flex;flex-direction:column;gap:14px;align-items:flex-end}
.mix-chip{display:flex;align-items:center;gap:12px;padding:14px 22px;background:rgba(16,15,14,.82);
  border:1px solid var(--hairline);border-right:4px solid var(--ch);
  font-family:'Geist Mono',monospace;font-size:24px;color:var(--text);opacity:0}
.mix-dot{width:12px;height:12px;border-radius:50%;background:var(--ch);box-shadow:0 0 14px var(--ch)}
.mix-line{font-size:26px;color:var(--text-2);opacity:0;padding-right:4px}
.mix-line b{color:var(--accent);font-weight:700}
.end-wrap{z-index:10;display:grid;place-items:center}
.end{display:flex;flex-direction:column;align-items:center;text-align:center}
.end-icon{width:150px;height:150px;opacity:0}
.end-name{font-size:88px;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-top:28px;opacity:0}
.end-tag{font-size:38px;color:var(--text-2);margin-top:12px;opacity:0}
.end-repo{font-family:'Geist Mono',monospace;font-size:34px;color:var(--accent);margin-top:40px;opacity:0}
.end-sub{font-size:26px;color:var(--muted);margin-top:16px;opacity:0}
</style>
</head>
<body>
<div id="root" data-composition-id="podframes-launch" data-start="0" data-width="${W}" data-height="${H}" data-duration="${r2(TOTAL)}" data-fps="${FPS}">
${videos}
${audios}
${overlays}
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
(function(){
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });
${tl.join("\n")}
  window.__timelines["podframes-launch"] = tl;
})();
</script>
</div>
</body>
</html>
`;
}

// ── Music ducking envelope ─────────────────────────────────────────────────────
function volumeExpr(): string {
  // Techno present from second zero: audible under the hook, full for the
  // stinger and the (speechless) terminal, ducked under speech, end-card peak.
  const pts: Array<[number, number]> = [
    [0, 0.28], [r2(T_STING - 0.2), 0.28], [r2(T_STING), 0.55],
    [r2(T_INTRO - 0.1), 0.55], [r2(T_INTRO + 0.3), 0.24],
    [r2(T_TERM - 0.2), 0.24], [r2(T_TERM + 0.2), 0.55],
    [r2(T_COST - 0.2), 0.55], [r2(T_COST + 0.3), 0.24],
    [r2(T_END - 0.3), 0.24], [r2(T_END + 0.4), 0.6],
    [r2(TOTAL - 1.4), 0.6], [r2(TOTAL), 0],
  ];
  let expr = String(pts[pts.length - 1]![1]);
  for (let i = pts.length - 2; i >= 0; i--) {
    const [t0, v0] = pts[i]!;
    const [t1, v1] = pts[i + 1]!;
    const seg = t1 === t0 ? String(v1) : `${v0}+(${v1}-${v0})*(t-${t0})/${t1 - t0}`;
    expr = `if(lt(t,${t1}),${seg},${expr})`;
  }
  return expr;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const HTML_ONLY = process.argv.slice(2).includes("html");

  console.log(`launch video v2 · ${r2(TOTAL)}s`);
  prepMedia();
  await writeFile(join(COMP, "index.html"), buildHtml());
  console.log(`composition → ${join(COMP, "index.html")}`);
  if (HTML_ONLY) return;

  const env = { ...process.env, PRODUCER_BROWSER_GPU_MODE: "hardware" };
  try {
    execFileSync(HYPERFRAMES, ["lint", COMP], { env, stdio: "inherit" });
  } catch {
    console.warn("lint reported issues — rendering anyway");
  }

  const raw = join(LAUNCH, "launch.raw.mp4");
  // --workers 1: secondary capture workers on this machine render a viewport
  // 87px short (black band at the bottom); the primary worker is correct.
  execFileSync(HYPERFRAMES, ["render", COMP, "--output", raw, "--fps", String(FPS), "--quality", "high", "--workers", "1"], {
    env,
    stdio: "inherit",
  });

  // Black-first-frame fix (same as stages/render.ts): strip the empty leading edit list.
  const clean = join(LAUNCH, "launch.clean.mp4");
  ff(["-ignore_editlist", "1", "-i", raw, "-c", "copy", clean]);

  // Post-mix each techno bed under the speech (audio-only re-encode, video copied).
  const outs: string[] = [];
  for (const [suffix, bedName] of [["a", "techno-a-driving"], ["b", "techno-b-electro"]] as const) {
    const out = join(LAUNCH, `launch-video-${suffix}.mp4`);
    ff([
      "-i", clean, "-i", join(ROOT, "projects", "_launch", "music", `${bedName}.mp3`),
      "-filter_complex",
      `[1:a]apad,atrim=0:${r2(TOTAL)},volume='${volumeExpr()}':eval=frame[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[mix]`,
      "-map", "0:v", "-map", "[mix]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      out,
    ]);
    outs.push(out);
  }
  rmSync(raw, { force: true });
  rmSync(clean, { force: true });
  console.log(`\n✓ launch videos →\n${outs.map((o) => "  " + o).join("\n")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
