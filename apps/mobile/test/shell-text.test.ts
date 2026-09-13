// iOS smart punctuation on the way to a shell (S8) — the substitutions undone, nothing else touched.
import { describe, expect, it } from 'vitest';
import { asciiForShell } from '../src/shell-text';

describe('asciiForShell', () => {
  it('puts back the ASCII iOS replaced', () => {
    expect(asciiForShell('claude —version')).toBe('claude --version');
    expect(asciiForShell('git log –n 3')).toBe('git log -n 3');
    expect(asciiForShell('echo “hi”')).toBe('echo "hi"');
    expect(asciiForShell("cd ‘my dir’")).toBe("cd 'my dir'");
    expect(asciiForShell('ls src…')).toBe('ls src...');
    expect(asciiForShell('gh auth login')).toBe('gh auth login');
  });
  it('leaves an ordinary command exactly as typed', () => {
    const cmd = 'claude setup-token --scope user && echo "ok" | tee /tmp/a.log';
    expect(asciiForShell(cmd)).toBe(cmd);
    expect(asciiForShell('')).toBe('');
  });
});
