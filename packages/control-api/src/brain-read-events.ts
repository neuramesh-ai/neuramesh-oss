import type { BrainObjectRef, BrainObjectStore } from './brain-objects';
import { BrainError } from './brain-error';

/** Immutable segments can download together; their event order remains the committed order.
 * Bound concurrency, and drain in-flight reads before rejecting a corrupt/incomplete restore. */
export async function readBrainEvents(objects: Pick<BrainObjectStore, 'get'>, commits: readonly {
  segment: BrainObjectRef; event_count: number;
}[], project?: (event: unknown) => unknown): Promise<unknown[]> {
  const events: unknown[] = [];
  const limit = 64 * 1024 * 1024;
  const oversized = () => new BrainError('BRAIN_RESTORE_TOO_LARGE', 'This conversation needs a compact restore in an updated NeuraMesh client. Its complete archive remains saved.', 413);
  if (!project && commits.reduce((bytes, commit) => bytes + commit.segment.sizeBytes, 0) > limit) throw oversized();
  let size = 0;
  for (let offset = 0; offset < commits.length; offset += 8) {
    const batch = commits.slice(offset, offset + 8);
    // Retain at most one batch of raw bytes. Parse/project in order so cumulative text state
    // cannot race, and a long history never retains all of its expanded transport copies.
    const downloaded = await Promise.allSettled(batch.map(commit => objects.get(commit.segment)));
    const failure = downloaded.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    for (const [index, result] of downloaded.entries()) {
      if (result.status !== 'fulfilled') continue;
      const lines = result.value.toString('utf8').split('\n').filter(Boolean);
      if (lines.length !== batch[index]!.event_count) throw new Error('Brain event count does not match');
      for (const line of lines) {
        const value: unknown = JSON.parse(line);
        const event = project ? project(value) : value;
        if (event === undefined) continue; // An explicit display projection may omit unrelated events.
        size += Buffer.byteLength(project ? JSON.stringify(event) : line);
        if (size > limit) throw oversized();
        events.push(event);
      }
    }
  }
  return events;
}
