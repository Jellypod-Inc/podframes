"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface Transport {
  time: number;
  duration: number;
  playing: boolean;
  seek: (t: number) => void;
  togglePlay: () => void;
}

const TransportCtx = createContext<Transport | null>(null);

export function useTransport(): Transport {
  const v = useContext(TransportCtx);
  if (!v) throw new Error("useTransport must be used within <TransportProvider>");
  return v;
}

/**
 * Owns the single conversation <audio> + playhead, isolated from the rest of the
 * editor. The playhead ticks ~4x/sec; keeping that state HERE (not in the wizard shell)
 * means only transport consumers (scrubber/karaoke/word-rail/timecode) re-render on
 * a tick — the inspector and static rail rows don't.
 */
export function TransportProvider({
  src,
  srcKey,
  durationSec,
  children,
}: {
  src: string | null;
  srcKey: string;
  durationSec: number;
  children: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    const clamped = Math.max(0, t);
    if (a) {
      a.currentTime = clamped;
      setTime(a.currentTime);
    } else {
      setTime(clamped);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  // Keyboard transport (ignored while typing); reads live position so it binds once.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("input, textarea, select, [contenteditable='true']")) return;
      const now = audioRef.current?.currentTime ?? 0;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        seek(now - (e.shiftKey ? 5 : 2));
      } else if (e.key === "ArrowRight" || e.key === "l") {
        seek(now + (e.shiftKey ? 5 : 2));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek, togglePlay]);

  const value: Transport = { time, duration: durationSec, playing, seek, togglePlay };

  return (
    <TransportCtx.Provider value={value}>
      {src && (
        <audio
          key={srcKey}
          ref={audioRef}
          src={src}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      )}
      {children}
    </TransportCtx.Provider>
  );
}
