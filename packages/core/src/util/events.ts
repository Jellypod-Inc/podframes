import type { ClipProgress, PipelineEvent, ProgressHandler, StageName } from "../types";

/** Tiny progress reporter: fan out to a handler + (optionally) the console. */
export class Reporter {
  private handlers: ProgressHandler[] = [];

  constructor(opts: { console?: boolean } = {}) {
    if (opts.console !== false) this.handlers.push(consoleHandler);
  }

  on(handler: ProgressHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  emit(event: Omit<PipelineEvent, "at">): void {
    const full: PipelineEvent = { ...event, at: new Date().toISOString() };
    for (const h of this.handlers) {
      try {
        h(full);
      } catch {
        /* a bad listener must never break the pipeline */
      }
    }
  }

  stage(stage: StageName | "pipeline") {
    return {
      info: (message: string, data?: Record<string, unknown>, progress?: number) =>
        this.emit({ stage, level: "info", message, data, progress }),
      warn: (message: string, data?: Record<string, unknown>) =>
        this.emit({ stage, level: "warn", message, data }),
      error: (message: string, data?: Record<string, unknown>) =>
        this.emit({ stage, level: "error", message, data }),
      success: (message: string, data?: Record<string, unknown>) =>
        this.emit({ stage, level: "success", message, data }),
      progress: (progress: number, message: string) =>
        this.emit({ stage, level: "info", message, progress }),
      /** Typed per-clip progress — the studio's live clip rail consumes this
       *  directly instead of string-matching a free-form data bag. */
      clip: (message: string, clip: ClipProgress) =>
        this.emit({ stage, level: "info", message, clip }),
    };
  }
}

const ICON: Record<PipelineEvent["level"], string> = {
  info: "·",
  warn: "!",
  error: "✗",
  success: "✓",
};

function consoleHandler(e: PipelineEvent): void {
  const pct = e.progress != null ? ` ${Math.round(e.progress * 100)}%` : "";
  const line = `  ${ICON[e.level]} [${e.stage}]${pct} ${e.message}`;
  if (e.level === "error") console.error(line);
  else console.log(line);
}
