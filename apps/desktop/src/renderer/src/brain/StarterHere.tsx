// "USE NEURAMESH BRAIN HERE" — the one-tap switch of a conversation's brain to the house model
// (George, 2026-09-16: "we should be able to switch the active brain config to starter at any point,
// which should reseat all the agents in that thread"). The Roles view already lets a person move one
// seat at a time through the picker; this moves EVERY seat in the cast to the Starter model in one
// apply, so a thread stops depending on any vendor login from its next turn on — the unit's legs and
// spawned subagents included (host/hire.ts reads the owning conversation's brain for a task).
//
// Pinned seats move too (2026-09-17, docs/10 §15.1): the pin is the seat's default everywhere, the
// conversation's word is THIS conversation's — and the live harness showed a pinned orchestrator
// running a routine on the human's vendor login while the thread said Starter. The roles list keeps
// saying "pinned by you" so the person knows where the seat returns to when the override is reset.
import { STARTER_MODEL, type AgentRole, type BrainOverride } from '@neuramesh/shared';
import { useState } from 'react';

/** every seat in the cast → the house model; a cast already there yields null (nothing to apply) */
export function starterOverrideFor(cast: ReadonlyArray<{ role: AgentRole; model: string; pinned: boolean }>): BrainOverride | null {
  const out: BrainOverride = {};
  for (const s of cast) out[s.role] = STARTER_MODEL;
  const already = cast.every((s) => s.model === STARTER_MODEL);
  return Object.keys(out).length && !already ? out : null;
}

export function StarterHere({ cast, disabled, apply }: {
  cast: ReadonlyArray<{ role: AgentRole; model: string; pinned: boolean }>;
  disabled?: boolean;
  /** the chip's own apply path — a thread's set_brain, or the sticky draft before a thread exists */
  apply: (override: BrainOverride) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const next = starterOverrideFor(cast);
  if (!next) return null;
  const n = Object.keys(next).length;
  return (
    <button className="bpmini" disabled={busy || disabled}
      title={`Every seat here runs on the NeuraMesh brain from its next turn, on credits — no Claude, Codex or Gemini login needed. Moves ${n} seat${n === 1 ? '' : 's'}, pinned ones too. Reset returns each seat to its default.`}
      onClick={() => { setBusy(true); void apply(next).finally(() => setBusy(false)); }}>
      {busy ? 'Switching…' : 'Use NeuraMesh brain here'}
    </button>
  );
}
