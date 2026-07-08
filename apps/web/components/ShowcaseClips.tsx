"use client";

import { useEffect, useRef } from "react";

const CLIPS = [
  { slug: "cost", title: "What did this cost?", tag: "live receipt on screen" },
  { slug: "dinosaurs", title: "Why did the dinosaurs die?", tag: "b-roll + stat cards" },
  { slug: "con", title: "The Eiffel Tower con", tag: "bold captions" },
  { slug: "commit", title: "This week in JavaScript", tag: "neon captions" },
] as const;

/**
 * Vertical episode gallery. Clips use preload="none" and only start
 * (i.e. download) once scrolled into view — so a visitor who bounces at the
 * hero pays zero video bandwidth. They pause again when scrolled away.
 */
export function ShowcaseClips() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const videos = Array.from(root.querySelectorAll("video"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) v.play().catch(() => {});
          else v.pause();
        }
      },
      // start loading a little before it enters the viewport, so it's playing by the time it's visible
      { rootMargin: "300px 0px", threshold: 0.2 },
    );
    videos.forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={rootRef}
      className="-mx-5 flex snap-x gap-5 overflow-x-auto px-5 pb-3 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"
    >
      {CLIPS.map((c) => (
        <figure key={c.slug} className="w-[62%] shrink-0 snap-start sm:w-auto">
          <div className="panel overflow-hidden rounded-none">
            <video
              className="aspect-[9/16] w-full bg-black"
              muted
              loop
              playsInline
              preload="none"
              poster={`/showcase/clip-${c.slug}.jpg`}
            >
              <source src={`/showcase/clip-${c.slug}.mp4`} type="video/mp4" />
            </video>
          </div>
          <figcaption className="mt-3">
            <div className="text-sm font-semibold leading-snug">{c.title}</div>
            <div className="mono mt-1 text-[11px] text-[var(--color-text-muted)]">{c.tag}</div>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
