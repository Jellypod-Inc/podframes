"use client";

import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { ProjectDetail, PatchBody } from "@/components/studio/api";
import type { DonePayload, LogLine } from "@/components/studio/useRun";
import type { CastChannel, Aspect } from "./cast";

/** The five human steps. Seven engine stages collapse into these. */
export const STEPS = [
  { n: 1, label: "Cast & voice" },
  { n: 2, label: "Script" },
  { n: 3, label: "Videos" },
  { n: 4, label: "B-roll & captions" },
  { n: 5, label: "Output" },
] as const;

export interface GenerateOpts {
  only?: string[];
  to?: string;
  force?: boolean;
  /** Animate only these turn indices in the video stage (the Step-3 checkboxes). */
  onlyTurns?: number[];
}

export interface ConfirmOptions {
  title: string;
  body: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "warn" | "danger";
}

export type ClipTrimDraft = { trimStartSec: number; trimEndSec: number };

export interface WizardCtx {
  slug: string | null;
  project: ProjectDetail | null;
  step: number;
  /** Furthest step the user can jump to (gated by what's been generated). */
  maxStep: number;
  go: (n: number) => void;

  /** Shared form state — lives in the shell so steps stay stateless across navigation. */
  cast: CastChannel[];
  setCast: (updater: (c: CastChannel[]) => CastChannel[]) => void;
  topic: string;
  setTopic: (s: string) => void;
  style: string;
  setStyle: (s: string) => void;
  aspect: Aspect;
  setAspect: (a: Aspect) => void;
  resolution: "720p" | "1080p";
  setResolution: (r: "720p" | "1080p") => void;

  busy: boolean;
  running: boolean;
  /** A run is streaming here, or a stage is mid-run on disk → lock edits. */
  locked: boolean;
  error: string | null;
  log: LogLine[];
  /** Unsaved clip trims, used so the preview pane updates while dragging. */
  clipTrimDrafts: Record<string, ClipTrimDraft>;
  setClipTrimDrafts: Dispatch<SetStateAction<Record<string, ClipTrimDraft>>>;

  /** Run a pipeline stage range. Creates the project on first run, then refetches state. */
  generate: (opts: GenerateOpts) => Promise<DonePayload | null>;
  /** Styled replacement for browser confirm(), shared by destructive edits and paid actions. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Edit config/hosts/script/cues/options (invalidates downstream stages server-side), then refetch.
   *  `silent` skips the global busy flag — for background autosaves that must not disable the editor. */
  patch: (body: PatchBody, opts?: { silent?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  /** Lazily create the project (from the current cast/topic) if none exists; returns the slug. */
  ensureProject: () => Promise<string | null>;
}

const Ctx = createContext<WizardCtx | null>(null);
export const WizardProvider = Ctx.Provider;

export function useWizard(): WizardCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWizard must be used within <Wizard>");
  return v;
}

/** Land the user on the step they should do next (or the finished video).
 *  Speech gates EVERYTHING: a per-turn voice/script edit invalidates the speech
 *  artifact while later stages can still read "done" (their clips are kept for
 *  cheap per-turn reuse) — so a pending speech always routes back to Step 2 to
 *  re-voice, never to a hollow Videos/Output step with no audio under it. */
export function resumeStep(p: ProjectDetail | null): number {
  if (!p) return 1;
  const s = p.stages;
  if (s.speech !== "done") return s.script === "done" ? 2 : 1;
  if (s.render === "done") return 5;
  if (s.broll === "done") return 5;
  if (s.video === "done") return 4;
  return 3;
}

/** Steps 3 (Videos) AND 4 (B-roll & captions) unlock once there's a synthesized
 *  conversation — captions and b-roll operate on the audio alone, so the cheap
 *  audio-first loop (script + mixed audio + styled captions + SRT export) works
 *  with zero video spend. Step 5 (Output) still requires generated videos — and
 *  everything past Step 2 requires LIVE speech (see resumeStep). */
export function maxStepFor(p: ProjectDetail | null): number {
  if (p?.stages?.speech !== "done") return 2;
  if (p?.stages?.video === "done") return 5;
  return 4;
}
