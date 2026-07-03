/** Suspense fallback while the studio page reads the project on the server. */
export default function Loading() {
  return <div className="grid h-[70vh] place-items-center text-sm text-[var(--color-text-muted)]">Loading session…</div>;
}
