/** A host-editor channel: who's talking, on what voice, and how they look. */
export interface Channel {
  id: string;
  name: string;
  provider: string;
  model: string;
  voice: string;
  side: "left" | "right";
  appearance: string;
  /** Script-writer personality hint — no editor in the studio, but round-tripped
   *  so a hosts PATCH never silently drops it (that reads as a script change). */
  persona?: string;
}
