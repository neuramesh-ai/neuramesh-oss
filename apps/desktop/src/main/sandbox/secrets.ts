// Containment L2 — secret-scan on submit. An agent's diff is scanned for credential shapes BEFORE
// anything leaves the machine (git push / PR). A leaked key in a commit is irreversible once pushed —
// rotating it is the only remedy — so the submit is blocked and the agent told to remove it. The
// rules are HIGH-CONFIDENCE provider/key shapes, not generic "password" heuristics, to keep the
// false-positive rate near zero: a false block would wrongly reject good work. `.nm-evidence/` is
// git-excluded, so scratch material never reaches the scanned diff in the first place.

export interface SecretFinding {
  rule: string;
  file: string;
  snippet: string; // redacted — we never echo the full secret back into logs/threads
}

// Each rule is a distinctive, low-collision shape. Deliberately conservative: we would rather miss an
// exotic token than block a legitimate submit on a coincidence.
const SECRET_RULES: ReadonlyArray<{ rule: string; re: RegExp }> = [
  { rule: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/ },
  { rule: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { rule: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { rule: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9-]{20,}\b/ },
  { rule: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{40,}\b/ },
  { rule: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: 'slack-token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { rule: 'stripe-secret-key', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{24,}\b/ },
  { rule: 'gcp-service-account-json', re: /"type"\s*:\s*"service_account"/ },
  { rule: 'generic-assigned-secret', re: /(?:api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']/i },
];

function redact(s: string): string {
  return s.length <= 10 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`;
}

// Scan the ADDED lines of a unified diff (the credentials an agent is INTRODUCING — pre-existing
// repo content on context lines is not our concern). Tracks the current file from the `+++ b/…`
// header so a finding names where to fix it.
export function scanDiffForSecrets(diff: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  let file = '(unknown)';
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, '').trim() || '(unknown)'; continue; }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue; // added lines only, not the +++ header
    const content = raw.slice(1);
    for (const { rule, re } of SECRET_RULES) {
      const m = re.exec(content);
      if (m) findings.push({ rule, file, snippet: redact(m[0]) });
    }
  }
  return findings;
}

// One-line, redacted summary for the block message the agent sees (never the raw secret).
export function formatSecretFindings(findings: readonly SecretFinding[]): string {
  return findings.map((f) => `${f.rule} in ${f.file} (${f.snippet})`).join('; ');
}
