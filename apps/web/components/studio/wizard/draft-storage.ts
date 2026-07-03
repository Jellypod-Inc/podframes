import type { Aspect, CastChannel } from "./cast";

const DRAFT_VERSION = 1;
const NEW_DRAFT_KEY = "podframes:studio:draft:new:v1";
const PROJECT_DRAFT_PREFIX = "podframes:studio:draft:project:";

type StudioDraft = {
  version: typeof DRAFT_VERSION;
  cast?: CastChannel[];
  topic?: string;
  style?: string;
  aspect?: Aspect;
  resolution?: "720p" | "1080p";
};

const draftStorageKey = (slug: string | null) =>
  slug ? `${PROJECT_DRAFT_PREFIX}${slug}:v1` : NEW_DRAFT_KEY;

export function readStudioDraft(slug: string | null): StudioDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(slug));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<StudioDraft>;
    return draft.version === DRAFT_VERSION ? (draft as StudioDraft) : null;
  } catch {
    return null;
  }
}

export function writeStudioDraft(slug: string | null, draft: Omit<StudioDraft, "version">): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftStorageKey(slug), JSON.stringify({ version: DRAFT_VERSION, ...draft }));
  } catch {
    // Storage can be unavailable in private contexts; project saves still cover persisted runs.
  }
}

export function clearStudioDraft(slug: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftStorageKey(slug));
  } catch {
    /* best effort */
  }
}
