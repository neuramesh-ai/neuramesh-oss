// ONE LINE PER TURN that says how the live narration went (round 9). The machine prints it to its log,
// and scripts/e2e-cloudrun/narration-measure.mjs reads it after a deploy: how long until the person saw
// the first word, how many tool calls in how many batches, and how many progress lines they got.
// The counts come from the stream the person sees, so the line measures what they saw, not what the
// model was asked to do.

export interface NarrationStats {
  /** a live update went out. `visible`: it carried words or progress lines the person can read */
  text(visible: boolean): void;
  /** the model's thoughts grew */
  thought(): void;
  /** one batch of tool calls started, with this many calls in it */
  batch(calls: number): void;
  /** one more call joined the batch that is running */
  call(): void;
  /** the progress lines the turn holds now */
  progress(lines: number): void;
  /** the log line, with the time since the turn began */
  line(outcome?: string): string;
}

export function narrationStats(lane: string, key = '', now: () => number = Date.now): NarrationStats {
  const start = now();
  let firstText = -1, firstThought = -1, tools = 0, batches = 0, progress = 0, thoughts = 0;
  return {
    text(visible) { if (visible && firstText < 0) firstText = now() - start; },
    thought() { thoughts += 1; if (firstThought < 0) firstThought = now() - start; },
    batch(calls) { batches += 1; tools += calls; },
    call() { tools += 1; },
    progress(lines) { progress = lines; },
    line(outcome = 'done') {
      return `narration_stats lane=${lane} key=${key || '-'} outcome=${outcome} tools=${tools} batches=${batches} progress=${progress} thoughts=${thoughts} firstTextMs=${firstText} firstThoughtMs=${firstThought} totalMs=${now() - start}`;
    },
  };
}
