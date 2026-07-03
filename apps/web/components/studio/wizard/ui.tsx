"use client";

import { useWizard } from "./context";

export const inputClass =
  "w-full min-w-0 rounded-none border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-60";

/** The title + one-line intent for a step. */
export function StepHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[17px] font-semibold leading-tight">{title}</h2>
      {hint && <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

/** Bottom action row: Back on the left (auto from step), the step's primary action(s) on the right. */
export function StepFooter({ children }: { children: React.ReactNode }) {
  const { step, go } = useWizard();
  return (
    <div className="mt-7 flex items-center justify-between gap-3 border-t border-[var(--color-hairline)] pt-5">
      {step > 1 ? (
        <button onClick={() => go(step - 1)} className="mono text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">‹ back</button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
