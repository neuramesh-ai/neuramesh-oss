// THE CHROME'S TWO STATUS MARKS, together (cloud-cap round; icon pass 2026-08-29).
//
// Sync and the cloud machine sit side by side at the top right, and they answer two halves of one
// question a person actually has: is my work saved, and is anything able to act on it.
//
// BOTH ARE DRAWN, NOT LABELLED. They used to print bare words, "Local" and "Capped", and George
// read the shipped chrome and could not tell what either meant. That is the correct verdict: a
// status word in a corner has no subject. "Capped" does not say what is capped; "Local" does not
// say what is local or why it matters; and side by side they read as two unrelated labels rather
// than two facts about two different things.
//
// An icon carries its subject in its shape, which a word in a 60px pill cannot, and moving the
// sentence to hover buys room for a real explanation instead of one adjective. So: a cloud for
// the work, a machine for the compute, and a `data-tip` on each that says what is true and what
// it means for you. `.ftutils [data-tip]` already right-flips near the frame edge, so neither
// bubble runs off screen (docs/33 §9.6).
import type { ComputeView } from '../compute/useCompute';
import type { ConnectionKind } from '../bridge/nm';
import { ComputePill } from './computepill';

export function StatusCluster({ live, connected, queuedWrites, syncedOnce, compute, onOpenCompute, connection }: {
  /** an agent is working somewhere in this workspace right now */
  live: boolean;
  connected: boolean;
  queuedWrites: number;
  /** we have synced at least once, so "offline" is a real state rather than a cold start */
  syncedOnce: boolean;
  /** null while the meter has not been read, or when the workspace has no cloud machine at all */
  compute: ComputeView | null;
  onOpenCompute: () => void;
  /** which backend the shell stands in (main/connections.ts) — the mark reads `local` on the local stack (A5) */
  connection?: ConnectionKind;
}) {
  const local = connection === 'local';
  const queued = connected && queuedWrites > 0;
  // every branch says what is true AND what it means for your work, because that is the question
  // behind the glance: not "what is the state" but "is anything of mine at risk"
  const syncTip = live
    ? 'Agents are working right now.'
    : local
      ? (connected ? 'Local mode. Your data stays on this Mac.' : 'Local mode. The local stack starts. Please wait…')
    : connected
      ? queued
        ? `Synced to cloud. ${queuedWrites} write${queuedWrites === 1 ? '' : 's'} still uploading.`
        : 'Synced to cloud. Everything you have written is saved.'
      : syncedOnce
        ? 'Offline. Your writes are queued here and upload when the connection returns.'
        : 'Running locally. Nothing is syncing to the cloud yet.';

  return (
    <>
      {compute && <ComputePill status={compute.status} reason={compute.reason} onOpen={onOpenCompute} />}
      <span className={`livepill${live ? ' on' : ''}${connected ? '' : ' off'}${local ? ' loc' : ''}`} data-tip={syncTip} aria-label={syncTip}>
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          {/* sync: two arrows chasing round — the motion of writes leaving and state arriving. It
              was a cloud, which beside the cloud-machine pill read as the same fact twice
              (George, 2026-09-05); the cloud now lives on the machine that IS one */}
          <path d="M15.4 9a6.4 6.4 0 0 1-11 4.5" strokeLinecap="round" />
          <path d="M2.6 9a6.4 6.4 0 0 1 11-4.5" strokeLinecap="round" />
          <path d="M2.6 15.4v-3.6h3.6" strokeLinecap="round" />
          <path d="M15.4 2.6v3.6h-3.6" strokeLinecap="round" />
          {/* offline: struck through, because nothing is moving */}
          {!connected && <path d="M3.2 15 14.8 3.4" strokeLinecap="round" />}
        </svg>
        {/* LIVE earns a mark of its own: something is happening RIGHT NOW, and a static icon
            cannot say "now". It is a motion cue beside the cloud, never a second label. */}
        {live && <span className="livedot" />}
        {local && 'local'}
      </span>
    </>
  );
}
