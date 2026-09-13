// A SEND THAT DIES MUST SAY SO (George on TestFlight build 24, 2026-09-06: "my message shows, but
// no thinking from the agent, nothing, and after a few seconds everything goes dark").
//
// The upload queue is strictly ordered and PowerSync retries a failed batch forever, so ONE
// permanently-rejected op wedges every later write. The guard for that is right: a definitive 4xx
// can never succeed, so the op is dropped and the queue moves on. What was missing is the other
// half. The dropped row is a LOCAL optimistic insert, so PowerSync removes it at the next
// checkpoint — the message the person watched themselves type is simply gone, with a console.warn
// nobody on a phone can read. A queue that keeps moving is right. A message that disappears in
// silence is not.
//
// This is the smallest thing that fixes the silence: the drop is remembered, the banner says it,
// and the text is kept so it can be typed back rather than reconstructed from memory.
export interface DroppedUpload {
  /** what the server said, already the server's own words (client-core `failure`) */
  reason: string;
  /** the body we could not deliver — offered back rather than lost */
  body: string;
  at: number;
}

let dropped: DroppedUpload | null = null;
const listeners = new Set<(d: DroppedUpload | null) => void>();

export function getDroppedUpload(): DroppedUpload | null {
  return dropped;
}

export function onDroppedUpload(fn: (d: DroppedUpload | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn(dropped);
}

export function noteDroppedUpload(reason: string, body: string): void {
  dropped = { reason, body, at: Date.now() };
  emit();
}

export function clearDroppedUpload(): void {
  if (!dropped) return;
  dropped = null;
  emit();
}
