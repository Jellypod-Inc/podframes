"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineEvent } from "@podframes/core";
import type { RunEvent, DonePayload as ServerDonePayload } from "@/lib/runs";

export type StageStatus = "pending" | "running" | "done" | "error";
/** A pipeline event straight off the run stream (typed end-to-end from core). */
export type LogLine = PipelineEvent;
export type DonePayload = ServerDonePayload;

export interface RunBody {
  slug: string;
  from?: string;
  to?: string;
  only?: string[];
  force?: boolean;
  /** Animate only these turn indices in the video stage. */
  onlyTurns?: number[];
}

/**
 * Client for the RunManager: POST /api/generate starts a run (202), then an
 * EventSource on /api/projects/[slug]/run streams progress. Because the run
 * lives server-side, `attach` also REATTACHES after a reload or from a second
 * tab — replaying the buffered events, then following live.
 */
export function useRun() {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const detach = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);
  useEffect(() => detach, [detach]);

  /** Attach to a project's (possibly already-running) run; resolves when it ends. */
  const attach = useCallback(
    (slug: string): Promise<DonePayload | null> => {
      detach();
      setRunning(true);
      setError(null);
      setLog([]);
      return new Promise((resolve) => {
        const es = new EventSource(`/api/projects/${encodeURIComponent(slug)}/run`);
        esRef.current = es;
        let settled = false;
        const finish = (d: DonePayload | null) => {
          if (settled) return;
          settled = true;
          setRunning(false);
          es.close();
          if (esRef.current === es) esRef.current = null;
          resolve(d);
        };
        es.onmessage = (m) => {
          let obj: RunEvent;
          try {
            obj = JSON.parse(m.data) as RunEvent;
          } catch {
            return;
          }
          if (obj.type === "event" && obj.event) {
            setLog((prev) => [...prev.slice(-300), obj.event!]);
          } else if (obj.type === "done") {
            finish(obj.done ?? null);
          } else if (obj.type === "error") {
            setError(obj.message ?? "pipeline failed");
            finish(null);
          }
        };
        es.onerror = () => {
          // The server closes the stream after done/error (handled above). A
          // CLOSED state here means the run record is gone (server restarted):
          // stop and let the reconciled project state explain what happened.
          if (es.readyState === EventSource.CLOSED) finish(null);
        };
      });
    },
    [detach],
  );

  /** Start a run for an EXISTING project, then follow it. */
  const start = useCallback(
    async (body: RunBody): Promise<DonePayload | null> => {
      setError(null);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.text().catch(() => "")) || `run failed to start (${res.status})`);
        return null;
      }
      return attach(body.slug);
    },
    [attach],
  );

  /** Cooperatively cancel the project's in-flight run. */
  const cancel = useCallback(async (slug: string): Promise<void> => {
    await fetch(`/api/projects/${encodeURIComponent(slug)}/run`, { method: "DELETE" }).catch(() => {});
  }, []);

  return { start, attach, cancel, running, log, error };
}
