import { getRun, subscribe, cancelRun, type RunEvent } from "@/lib/runs";
import { safeSlug } from "@/lib/root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Attach to a project's run: replays the buffered events, then follows live,
 * with a heartbeat every 10s so proxies can't kill a silent render. 404 when no
 * run record exists (e.g. the dev server restarted) — the client treats that as
 * "nothing to reattach to" and falls back to the reconciled on-disk state.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  const run = getRun(safe);
  if (!run) return new Response("no run for this project", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | null = null;
      const send = (e: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Subscribe FIRST, then replay the snapshot — the seq gate means an event
      // arriving during replay is neither dropped nor duplicated.
      const snapshotLen = run.events.length;
      unsubscribe = subscribe(safe, (e) => {
        if (e.seq >= snapshotLen) {
          send(e);
          if (e.type === "done" || e.type === "error") close();
        }
      });
      for (const e of run.events.slice(0, snapshotLen)) send(e);
      // Already finished before we attached → replay carried the terminal event.
      if (run.status !== "running") return close();

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 10_000);

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Cooperatively cancel the project's in-flight run. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const safe = safeSlug(slug);
  if (!cancelRun(safe)) return new Response("no active run", { status: 404 });
  return Response.json({ ok: true, cancelling: true }, { status: 202 });
}
