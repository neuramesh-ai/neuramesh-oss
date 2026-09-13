// Per-machine FS-sandbox on/off, persisted in userData (default ON). Local, NOT synced — the sandbox
// is machine-level enforcement (it jails THIS machine's agent processes), so the toggle correlates with
// the NM_SANDBOX_FS env var, not with workspace state. The env var, when set, overrides this file
// (ops/CI); see sandboxFsEnabled() in runtime/adapter.ts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const settingFile = (userDataDir: string): string => join(userDataDir, 'sandbox.json');

export function readSandboxSetting(userDataDir: string): boolean {
  try {
    return (JSON.parse(readFileSync(settingFile(userDataDir), 'utf8')) as { enabled?: boolean }).enabled !== false;
  } catch {
    return true; // default ON — a missing or corrupt file means "jailed", never silently off
  }
}

export function writeSandboxSetting(userDataDir: string, enabled: boolean): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(settingFile(userDataDir), JSON.stringify({ enabled }), 'utf8');
}
