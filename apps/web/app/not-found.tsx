import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 text-center">
      <div>
        <h1 className="text-xl font-bold">Not found</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">That session doesn’t exist.</p>
        <Link href="/studio" className="btn btn-primary mt-6 inline-block px-5 py-2 text-sm">All sessions</Link>
      </div>
    </main>
  );
}
