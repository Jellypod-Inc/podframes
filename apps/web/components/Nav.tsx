import Link from "next/link";
import { SITE } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-hairline)] bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)]">
          <a href="#pipeline" className="hidden rounded-none px-3 py-2 hover:text-[var(--color-text)] sm:block">
            How it works
          </a>
          <a href="#providers" className="hidden rounded-none px-3 py-2 hover:text-[var(--color-text)] sm:block">
            Voices
          </a>
          <a href="#quickstart" className="hidden rounded-none px-3 py-2 hover:text-[var(--color-text)] md:block">
            Quickstart
          </a>
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer"
            className="rounded-none px-3 py-2 hover:text-[var(--color-text)]"
          >
            GitHub
          </a>
          <Link href="/studio" className="btn btn-primary ml-2 px-4 py-2 text-sm">
            Open studio →
          </Link>
        </div>
      </nav>
    </header>
  );
}
