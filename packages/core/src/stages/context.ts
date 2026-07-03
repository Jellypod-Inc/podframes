import type { GeminiClient } from "../clients/gemini";
import type { Project } from "../project";
import type { ResolvedEnv } from "../config";
import type { Reporter } from "../util/events";

/** Everything a stage needs. Threaded through the orchestrator. */
export interface StageContext {
  project: Project;
  gemini: GeminiClient;
  env: ResolvedEnv;
  reporter: Reporter;
  /** Cooperative cancellation — worker pools stop claiming new units when aborted. */
  signal?: AbortSignal;
  /** Constrain the VIDEO stage's paid animation to these turn indices (the studio's
   *  checkboxes). Other turns' existing clips are kept; the stage only reports done
   *  when every turn is covered. */
  onlyTurns?: number[];
}
