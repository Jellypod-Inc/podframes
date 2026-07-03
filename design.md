# podframes — Design System

This is the **single source of truth** for brand. Both the web app (`apps/web`) and the
rendered video composition (HyperFrames) read from it. It is intentionally aligned with the
**Speechbase** identity so podframes reads as a first-party showcase.

> Brand DNA (Speechbase): _"The Prod Stack for AI Audio." Open by design. No lock-in._
> Dark-first, high-contrast, production-grade. Technical, not playful. Electric-cyan signal on warm charcoal.
> **Square by default** — zero corner radius and 1px hairline zoning, exactly like Speechbase. podframes
> inherits Speechbase's structural language wholesale; its *only* distinct brand mark is the cyan signal
> (and the patch-bay motif). If it looks like it shipped from speechbase.ai, that's correct.

---

## Signature

**The patch bay.** podframes routes *different TTS providers into one conversation* — so the
recurring motif is a **studio patch bay / mixing console**: each provider is a colored "patch
cable" / channel, and a conversation is those channels routed into a single stereo bus. It shows
up as the hero on the landing page, as the voice-channel picker in the studio, and as the
provider tags in the rendered video's lower-thirds. Spend the boldness here; keep everything else
quiet and disciplined.

---

## Color

Dark is the canvas. There is no light mode — a video production surface earns a single, controlled palette.

| Token              | Hex         | Use                                                           |
| ------------------ | ----------- | ------------------------------------------------------------ |
| `--bg`             | `#100F0E`   | App background (near-black, **warm** stone-charcoal)        |
| `--surface`        | `#181715`   | Cards, panels                                                |
| `--surface-2`      | `#201E1B`   | Raised surfaces, inputs, code blocks                         |
| `--hairline`       | `#2F2B27`   | 1px borders, dividers, grid lines                            |
| `--text`           | `#F4F2EC`   | Primary text (warm off-white)                                |
| `--text-secondary` | `#A8A298`   | Secondary text, labels                                       |
| `--text-muted`     | `#857C6F`   | Meta, timecodes, captions-off state (WCAG AA on `--bg`)      |
| `--accent`         | `#22D3EE`   | **Electric cyan — primary signal.** CTAs, active state, glow |
| `--accent-blue`    | `#5B8CFF`   | Electric blue — secondary signal, routes, links             |
| `--success`        | `#34D399`   | Done / healthy                                               |
| `--warn`           | `#FBBF24`   | Pending / attention                                          |
| `--danger`         | `#FF5C5C`   | Errors, the "REC" live dot                                   |

### Provider channel colors (the patch cables)

Each TTS provider gets a stable color so a mixed conversation is legible at a glance — in the
voice picker, the waveform, and the video's speaker tags.

| Provider    | Hex       |
| ----------- | --------- |
| OpenAI      | `#34D399` |
| ElevenLabs  | `#A78BFA` |
| Cartesia    | `#22D3EE` |
| Hume        | `#FB7185` |
| Google      | `#5B8CFF` |
| Inworld     | `#FBBF24` |
| Deepgram    | `#2DD4BF` |
| _fallback_  | `#9AA6B2` |

**Application:** accent at full saturation for focal elements; 12–20% for atmospheric glow.
On dark, cyan glows read naturally — use `box-shadow`/`radial-gradient` glows, not flat fills.
Tint neutral grays slightly **warm** (toward stone), never cool blue-black and never dead gray —
this warm-neutral cast is what makes the surfaces read as Speechbase rather than generic dark-mode.

---

## Typography

| Role            | Family                                  | Notes                                                      |
| --------------- | --------------------------------------- | --------------------------------------------------------- |
| Display / body  | **DM Sans**                             | Speechbase's marketing face — warm, geometric, technical.  |
| Mono / data     | **Geist Mono** (web), fallback monospace | Timecodes, provider/model IDs, code, channel labels.      |

- DM Sans is the universal web face (matches speechbase.ai). The HyperFrames video composition
  retains Inter for clean glyph embedding — that divergence is intentional and scoped to the renderer.
- Use heavy weights (700–800) for display, 400–500 for body, 500–600 for labels.
- Numerals: `font-variant-numeric: tabular-nums` everywhere numbers align (timecodes, credits).
- Type scale (web): 13 / 14 / 16 / 18 / 22 / 28 / 36 / 48 / 64. Display can go larger on the hero.
- **Video scale is different** — see HyperFrames rules: headlines 64–120px, body 28–42px, labels 18–24px.

---

## Shape, depth, motion

- **Radius:** **square — `--r-sm / --r / --r-lg: 0`.** Speechbase runs zero corner radius across every
  surface; podframes matches it. Box-shaped things (panels, cards, buttons, inputs, chips, tags, bars)
  are sharp. Only genuinely circular indicators stay round — status LEDs, provider-channel dots, the
  live/REC dot. No pills, no rounded-everything.
- **Depth:** solid color blocks, **no glassmorphism**. Elevation = a slightly lighter surface +
  a hairline border + (on accent elements) a soft cyan glow. Avoid heavy drop shadows.
- **Borders:** 1px hairline is the default structural device. Use it to build grids and zones.
- **Gradients:** minimal and purposeful — a single radial cyan glow behind the hero, subtle
  surface gradients on cards. No rainbow gradients, no full-screen linear gradients (banding).
- **Motion:** deliberate and orchestrated, not scattered. A page-load reveal sequence; a "routing"
  animation on the patch bay; waveform/level meters that pulse to the conversation. Respect
  `prefers-reduced-motion`. Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (expo-out) for entrances.

---

## Layout

- Generous whitespace; breathing room between sections (Speechbase hallmark).
- Zone-based, anchored layouts over centered-floating. Use the hairline grid to divide space.
- A persistent thin **top status rail** in the studio (project · provider mix · credits · render state)
  reinforces the "production console" feel.

---

## Voice & copy

Plain, active, developer-facing. Name things by what the user controls ("Generate", "Render",
"Mix voices"), never by system internals. Errors explain what happened and how to fix it, in the
interface's voice. Echo the Speechbase register: confident, technical, no fluff.

---

## Do / Don't

**Do**
- Lead with the patch-bay signature and the real provider/voice mix.
- Keep cyan as the single signal color; let it mean "active / routed / live".
- Use mono for every machine value (model IDs, timecodes, credits, durations).

**Don't**
- Glassmorphism, neon rainbow gradients, or playful rounded-everything.
- Generic centered hero with one big number + gradient blob.
- Dead gray neutrals or invisible 1px-on-dark borders (use the `--hairline` token).
- Invent colors or fonts outside this file.
