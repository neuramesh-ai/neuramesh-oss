export interface TimedTranscriptEntry<T> {
  at: number;
  order: number;
  value: T;
}

/** Keep messages and inline workflow components in one chronological stream. */
export function orderTranscriptEntries<T>(entries: TimedTranscriptEntry<T>[]): T[] {
  return [...entries]
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((entry) => entry.value);
}

/** A generated round enters the transcript when its first artifact is synced. */
export function designRoundAnchor(
  artifacts: Array<{ created_at: string }>,
  fallback: number,
): number {
  const timestamps = artifacts
    .map((artifact) => new Date(artifact.created_at).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? Math.min(...timestamps) : fallback;
}

/*
 * designHandoffAnchor was here. It preferred the LIFECYCLE time — the moment the task entered
 * `designing` — which pinned the handoff card to the start of the round, so every message posted
 * while designers worked sorted underneath it and the card sat stranded above them for the rest of
 * the thread's life. The card now renders only once a round is ready, and `designRoundAnchor` puts
 * it where the round actually landed. There is no anchor that needs a lifecycle time any more.
 */
