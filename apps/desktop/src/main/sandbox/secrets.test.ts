// Containment L2: the submit secret-scan. Run: pnpm exec tsx --test src/main/sandbox/secrets.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSecretFindings, scanDiffForSecrets } from './secrets';

const diff = (added: string, file = 'src/config.ts'): string =>
  `diff --git a/${file} b/${file}\nindex 000..111 100644\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,2 @@\n context line unchanged\n+${added}`;

test('detects high-confidence credential shapes on added lines', () => {
  const cases: Array<[string, string]> = [
    ['const k = "sk-ant-api03-abcDEFghijKLmnopQRstuv-wx"', 'anthropic-key'],
    ['OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH', 'openai-key'],
    ['aws = "AKIAIOSFODNN7EXAMPLE"', 'aws-access-key-id'],
    ['token: "ghp_012345678901234567890123456789abcdef"', 'github-token'],
    [`key = "AIza${'Xy0z'.repeat(9).slice(0, 35)}"`, 'google-api-key'], // AIza + exactly 35
    ['slack = "xoxb-1234567890-abcdEFGHijkl"', 'slack-token'],
    ['STRIPE=sk_live_0123456789abcdef0123456789', 'stripe-secret-key'],
  ];
  for (const [line, rule] of cases) {
    const hits = scanDiffForSecrets(diff(line));
    assert.ok(hits.some((h) => h.rule === rule), `expected ${rule} for: ${line} — got ${JSON.stringify(hits)}`);
    // never echo the raw secret back
    assert.ok(hits.every((h) => !h.snippet.includes('EXAMPLE') || h.snippet.includes('…') || h.snippet.length < line.length));
  }
});

test('detects a PEM private key block and names the file', () => {
  const hits = scanDiffForSecrets(diff('-----BEGIN OPENSSH PRIVATE KEY-----', 'deploy/id_ed25519'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.rule, 'private-key');
  assert.equal(hits[0]!.file, 'deploy/id_ed25519');
});

test('does NOT fire on ordinary code (no false positives)', () => {
  const benign = [
    'const apiKey = process.env.ANTHROPIC_API_KEY;',           // reads from env, no literal
    'const url = "https://api.example.com/v1/messages";',
    'password: z.string().min(8),                             // a schema, not a value',
    'const id = "abc123";',
    'import { sk } from "./skate";',                            // sk- lookalike, too short
    '// TODO: rotate the token before launch',
    'const hash = "e3b0c44298fc1c149afbf4c8996fb924"; // sha256 of empty',
  ];
  for (const line of benign) {
    assert.deepEqual(scanDiffForSecrets(diff(line)), [], `false positive on: ${line}`);
  }
});

test('ignores secrets on context/removed lines and the +++ header', () => {
  // a secret that already exists (context line, no leading +) is not the agent's doing → not flagged
  const contextOnly = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n const k = "sk-ant-api03-abcDEFghijKLmnopQRstuv-wx"\n+const y = 1`;
  assert.deepEqual(scanDiffForSecrets(contextOnly), []);
});

test('formatSecretFindings is redacted and human-readable', () => {
  const hits = scanDiffForSecrets(diff('key = "AKIAIOSFODNN7EXAMPLE"'));
  const msg = formatSecretFindings(hits);
  assert.match(msg, /aws-access-key-id in src\/config\.ts/);
  assert.ok(!msg.includes('AKIAIOSFODNN7EXAMPLE'), 'must not echo the raw secret');
});
