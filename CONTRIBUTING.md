# Contributing to podframes

Thanks for helping out. podframes is the official open-source showcase for
[Speechbase](https://speechbase.ai), maintained by Jellypod.

## Setup

Prerequisites: **Node ≥ 22**, **pnpm**, **ffmpeg** on PATH.

```bash
pnpm install          # install the workspace
pnpm typecheck        # typecheck every package
pnpm test             # run tests in every package that has them
pnpm dev:web          # run the studio at http://localhost:3000
```

The repo is a pnpm monorepo: `packages/core` (pipeline engine), `apps/cli` (headless runner),
`apps/web` (Next.js studio). `design.md` at the root is the brand truth for both the web app and
the rendered video — read it before touching UI or composition code.

Before opening a PR: `pnpm typecheck` and `pnpm test` must pass, and changes should match
`design.md`.

## Design philosophy

These are house rules, not suggestions:

- **Minimal UI.** Fewer controls, sensible defaults, help hidden until asked for.
- **No leaky abstractions.** Don't wrap provider APIs in our own vocabulary.
- **Expose raw provider params** rather than inventing wrapper options. If fal or Gemini has a
  knob, surface *their* knob.
- **Prefer cutting a managed feature over adding controls.** If a feature needs a settings panel
  to be usable, it's probably the wrong feature.

## Agent skills

Agent skills used during development are pinned in `skills-lock.json` (source repo + path +
content hash) and fetched locally into `.agents/`, which is gitignored. If you change which skills
the repo uses, update `skills-lock.json` — never commit `.agents/` itself.

## Security

Please do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
