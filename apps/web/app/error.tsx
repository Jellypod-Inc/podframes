"use client";

/** Root error boundary — replaces Next's default for any render/data throw. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 text-center">
      <div>
        <h1 className="text-xl font-bold">Something broke</h1>
        <p className="mono mt-2 text-sm text-[var(--color-text-muted)]">{error.message || "An unexpected error occurred."}</p>
        <button onClick={reset} className="btn btn-primary mt-6 px-5 py-2 text-sm">Try again</button>
      </div>
    </main>
  );
}
