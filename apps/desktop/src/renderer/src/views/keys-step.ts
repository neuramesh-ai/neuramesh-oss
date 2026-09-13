// THE KEYS STEP'S TWO SHAPES (the source-release round, review F13, artboard G). On a cloud
// connection the step is not a gate: the starter brain is a door, and Continue is always live. On a
// LOCAL connection there is no starter brain — no credits exist on this Mac — so a provider is
// required: the door is absent, the sentence says so, and Continue is a ghost until one provider is
// ready and the primary after. A function, so the wizard and its test read the same rule.

/** every sentence the local variant reads (CLAUDE.md #11) — the artboard's words */
export const KEYS_LOCAL_COPY = {
  title: 'Connect a brain',
  sub: 'Sign in to one provider to continue. Nothing leaves this Mac.',
} as const;

export interface KeysStep {
  /** the starter-brain door renders */
  door: boolean;
  canContinue: boolean;
  /** the Continue button's face: a ghost while the step waits on a provider */
  continueKind: 'primary' | 'ghost';
}

export function keysStepFor(input: { local: boolean; anyReady: boolean }): KeysStep {
  if (!input.local) return { door: true, canContinue: true, continueKind: 'primary' };
  return { door: false, canContinue: input.anyReady, continueKind: input.anyReady ? 'primary' : 'ghost' };
}
