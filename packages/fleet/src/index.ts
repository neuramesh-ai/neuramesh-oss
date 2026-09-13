// nm-fleet: rows in, workloads out (docs/design/cloud-first-2026-08/architecture.md §3).
//
// desired state comes from FLEET_DESIRED_FILE (dev, e2e) or FLEET_DESIRED_URL (control-api,
// authenticated with FLEET_TOKEN) — re-read every tick, so the file/endpoint is the one
// switch that wakes, stops, creates, and removes machines. `--once` runs a single
// reconcile and exits: the shape both the k3d e2e and a debugging human want.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kube, loadAuth } from './kube.js';
import { reconcile, type TokenMinter } from './reconcile.js';
import { loadTemplate } from './template.js';
import type { DesiredState, FleetEnv } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const templatesDir =
  process.env['FLEET_TEMPLATES_DIR'] ?? join(here, '..', '..', '..', 'infra', 'k8s', 'templates');

const env: FleetEnv = {
  storageClass: process.env['FLEET_STORAGE_CLASS'] ?? '',
  runtimeClass: process.env['FLEET_RUNTIME_CLASS'] ?? '',
  image: process.env['FLEET_MACHINE_IMAGE'] ?? 'busybox:stable',
  powersyncUrl: process.env['FLEET_POWERSYNC_URL'] ?? '',
  apiUrl: process.env['FLEET_API_URL'] ?? '',
  relayUrl: process.env['FLEET_RELAY_URL'] ?? '',
  machineCommand: process.env['FLEET_MACHINE_COMMAND'] ?? '',
};

async function loadDesired(): Promise<DesiredState> {
  const file = process.env['FLEET_DESIRED_FILE'];
  if (file) return JSON.parse(readFileSync(file, 'utf8')) as DesiredState;
  const url = process.env['FLEET_DESIRED_URL'];
  if (url) {
    const res = await fetch(url, {
      headers: process.env['FLEET_TOKEN'] ? { authorization: `Bearer ${process.env['FLEET_TOKEN']}` } : {},
    });
    if (!res.ok) throw new Error(`desired-state fetch failed: ${res.status}`);
    return (await res.json()) as DesiredState;
  }
  throw new Error('set FLEET_DESIRED_FILE or FLEET_DESIRED_URL');
}

// token custody rides the same credential as the desired-state poll: in API mode the
// operator mints a machine's token from control-api the moment it writes the Secret —
// nothing else ever holds the plaintext. file mode (k3d, fixtures) has no minter, so
// missing secrets surface as `skipped`, never as an invented credential.
function loadMinter(): TokenMinter | undefined {
  const url = process.env['FLEET_DESIRED_URL'];
  const token = process.env['FLEET_TOKEN'];
  if (!url || !token) return undefined;
  return async (machineId: string): Promise<string> => {
    const res = await fetch(new URL(`/internal/machines/${machineId}/token`, url), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`token mint for ${machineId} failed: ${res.status}`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error(`token mint for ${machineId} returned no token`);
    return body.token;
  };
}

async function tick(kube: Kube, minter: TokenMinter | undefined): Promise<void> {
  const desired = await loadDesired();
  const templates = {
    workspace: loadTemplate(join(templatesDir, 'workspace.yaml')),
    machine: loadTemplate(join(templatesDir, 'machine.yaml')),
  };
  const result = await reconcile(kube, desired, env, templates, minter);
  const summary = `applied=${result.applied} deleted=${result.deleted} skipped=${result.skipped} errors=${result.errors.length}`;
  console.log(`[fleet] ${new Date().toISOString()} ${summary}`);
  for (const e of result.errors) console.error(`[fleet]   ${e.action.op} failed: ${e.error}`);
}

async function main(): Promise<void> {
  const kube = new Kube(loadAuth());
  const minter = loadMinter();
  const once = process.argv.includes('--once');
  if (once) {
    await tick(kube, minter);
    return;
  }
  const interval = Number(process.env['FLEET_INTERVAL_MS'] ?? 10_000);
  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  while (!stopping) {
    try {
      await tick(kube, minter);
    } catch (err) {
      console.error(`[fleet] tick failed: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((err) => {
  console.error(`[fleet] fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
