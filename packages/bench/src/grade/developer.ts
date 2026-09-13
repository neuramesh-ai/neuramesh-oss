// Objective grading for the developer role — mirrors the real submit gate: a change passes only
// if it applies cleanly (a well-formed edit), makes the hidden target tests pass (FAIL_TO_PASS),
// and doesn't break previously-passing tests (PASS_TO_PASS).
export interface DevGradeInput {
  wellFormedEdit: boolean;
  failToPass: boolean;
  passToPass: boolean;
}

export function scoreDev(g: DevGradeInput): boolean {
  return g.wellFormedEdit && g.failToPass && g.passToPass;
}
