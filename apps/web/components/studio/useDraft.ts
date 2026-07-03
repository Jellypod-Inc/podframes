import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * A local editable draft that RESETS to `serverValue` whenever `version` changes
 * (e.g. project.updatedAt after a save). Uses React's render-time state-adjust
 * pattern — no effect — so a mid-edit server refresh re-seeds cleanly without the
 * cascading-render smell of `useEffect(() => setX(serverValue), [version])`.
 */
export function useDraft<T>(serverValue: T, version: string): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(serverValue);
  const [seenVersion, setSeenVersion] = useState(version);
  if (version !== seenVersion) {
    setSeenVersion(version);
    setDraft(serverValue);
  }
  return [draft, setDraft];
}
