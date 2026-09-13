// Policy-table derivations (docs/policy) — extracted from App.tsx (track A2).
// Pure data + predicates; PolicyPanel keeps the rendering.
import type { PolicyRule } from '@neuramesh/shared';

export const V_COLOR: Record<string, string> = { allow: 'var(--green)', ask: 'var(--review)', deny: 'var(--blocked)' };

export const POLICY_GROUPS: Array<{ title: string; caps: string[] }> = [
  { title: 'Filesystem', caps: ['fs.write', 'fs.read'] },
  { title: 'Shell', caps: ['shell.exec'] },
  { title: 'Network', caps: ['net.egress'] },
  { title: 'Tools & git', caps: ['tool.mcp', 'vcs.push', 'pkg.install'] },
];

export function selectorLabel(s: PolicyRule['selector']): string {
  switch (s.kind) {
    case 'shellClass': return s.value;
    case 'host': return s.glob;
    case 'path': return s.glob;
    case 'flag': return s.name;
    case 'tool': return s.name;
    default: return 'any';
  }
}

export function sameSelector(a: PolicyRule['selector'], b: PolicyRule['selector']): boolean {
  return a.kind === b.kind && selectorLabel(a) === selectorLabel(b);
}

// The credential stores the sandbox always jails (mirrors the daemon's fsjail CRED_TARGETS) — shown
// locked. A workspace ADDS to these with fs.read deny path rules (the input below), which the sandbox
// kernel-enforces too. pathOfGlob unwraps a `**/<path>/**` selector back to the path for display.
export const DEFAULT_PROTECTED = ['.ssh', '.aws', '.gnupg', '.kube', '.config/gcloud', '.docker/config.json', '.netrc'];

export function pathOfGlob(glob: string): string { const m = /^\*\*\/(.+?)(?:\/\*\*)?$/.exec(glob); return m ? m[1]! : glob; }

export function isProtectedPathRule(r: PolicyRule): boolean { return r.capability === 'fs.read' && r.verdict === 'deny' && r.selector.kind === 'path'; }
