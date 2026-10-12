/** Real, billed provider smoke. Run only against an explicitly selected local test API.
 * node --import tsx scripts/brain-gcs-real.ts
 * NM_BRAIN_TEST_API, NM_BRAIN_TEST_WORKSPACE, NM_BRAIN_TEST_CHANNEL, NM_BRAIN_TEST_ACTOR,
 * NM_BRAIN_TEST_REPO, NM_BRAIN_TEST_CLONE and NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS are required.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EngineeringRuntimeEvent } from '../src/engineering-protocol';
import { createClineEngineeringHost } from '../src/main/relay/engineering-host';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const apiUrl = required('NM_BRAIN_TEST_API');
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiUrl)) throw new Error('This proof must target a local test API.');
const workspace = required('NM_BRAIN_TEST_WORKSPACE');
const actorId = required('NM_BRAIN_TEST_ACTOR');
const repoId = required('NM_BRAIN_TEST_REPO');
const headers = { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId }) };

async function child(): Promise<void> {
  const device = required('NM_BRAIN_TEST_DEVICE');
  const profile = required('NM_BRAIN_TEST_PROFILE');
  const threadId = required('NM_BRAIN_TEST_THREAD');
  const model = required('NM_BRAIN_TEST_MODEL');
  const prompt = required('NM_BRAIN_TEST_PROMPT');
  assert.equal(existsSync(join(profile, 'brain')), false, 'This device must have no local brain');
  assert.equal(existsSync(join(profile, 'cline')), false, 'This device must have no native model history');
  mkdirSync(profile, { recursive: true });
  const cwd = join(profile, 'repo');
  execFileSync('git', ['clone', '-q', required('NM_BRAIN_TEST_CLONE'), cwd], { stdio: 'pipe' });
  process.env['NM_BRAIN'] = join(profile, 'brain');
  process.env['NM_USERDATA'] = join(profile, 'userdata');
  process.env['CLINE_DATA_DIR'] = join(profile, 'cline');
  const events: EngineeringRuntimeEvent[] = [];
  let done = false;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const settled = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const timer = setTimeout(() => fail(new Error('The real model turn exceeded four minutes')), 240_000);
  const session = await createClineEngineeringHost({
    apiUrl, workspaceId: workspace, machineToken: '', authHeaders: async () => headers,
    brainRoot: join(profile, 'brain'), resolveCwd: async () => ({ cwd, repoRoot: cwd }), resolveBrain: async () => ({ modelId: model }),
    log: (line) => { if (line.startsWith('brain_')) process.stdout.write(`${line}\n`); },
  }).open({ threadId, actorId, repoId, repoName: 'Brain GCS proof', branch: 'main', mode: 'act', modelId: model,
    permissions: { read: true, edit: true, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true },
  }, (event) => {
    events.push(event);
    if (event.type === 'approval') queueMicrotask(() => session.command({ type: 'approval', approvalId: event.approvalId, approved: event.category === 'read' || event.category === 'edit' }));
    if (event.type === 'error' && event.code !== 'BRAIN_SYNC_PENDING') fail(new Error(event.message));
    if (event.type === 'agent_event' && (event.event['payload'] as any)?.event?.type === 'done') done = true;
    if (done && (event.type === 'ended' || (event.type === 'status' && event.status === 'idle'))) finish();
  });
  try {
    if (device === 'b') assert.ok(existsSync(join(cwd, '.nm-artifacts', 'proof.svg')), 'The second device must restore the cloud artifact before its model starts');
    session.command({ type: 'prompt', prompt });
    await settled;
    await session.flush!();
    const answers = events.flatMap((event) => event.type === 'agent_event' ? [(event.event['payload'] as any)?.event] : []).filter((event) => event?.type === 'done').map((event) => event.text).filter(Boolean);
    assert.ok(answers.length, 'The model must produce a real final answer');
    const bytes = readFileSync(join(cwd, '.nm-artifacts', 'proof.svg'));
    writeFileSync(join(profile, 'result.json'), JSON.stringify({ device, model, threadId, answers, sha256: createHash('sha256').update(bytes).digest('hex'), events }, null, 2));
    process.stdout.write(JSON.stringify({ device, model, answers, sha256: createHash('sha256').update(bytes).digest('hex') }) + '\n');
  } finally { clearTimeout(timer); session.close(); }
}

async function runDevice(env: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--import', 'tsx', resolveScript()], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    processChild.stdout.on('data', (data) => process.stdout.write(data));
    let errors = '';
    processChild.stderr.on('data', (data) => { errors += String(data); });
    processChild.on('error', reject);
    processChild.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Device failed (${code}): ${errors.slice(-2000)}`)));
  });
}
const resolveScript = (): string => resolve('scripts/brain-gcs-real.ts');

async function main(): Promise<void> {
  if (process.env['NM_BRAIN_TEST_DEVICE']) return child();
  required('NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS');
  const root = process.env['NM_BRAIN_TEST_ROOT'] ?? `/tmp/nm-brain-gcs-real-${Date.now()}`;
  mkdirSync(root, { recursive: true });
  const threadId = randomUUID();
  const nonce = `copper-kestrel-${randomUUID().slice(0, 8)}`;
  const firstPrompt = `Remember this private conversation passphrase exactly: ${nonce}. Keep the passphrase only in our conversation. Do not put it in any file. Create .nm-artifacts/proof.svg as a simple valid SVG with a blue circle and the words Cloud proof. Use your file editor tool, then read the file to verify it. Do not use shell commands. End with the passphrase and a brief result.`;
  const birth = await fetch(`${apiUrl}/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ id: randomUUID(), workspace, channel: required('NM_BRAIN_TEST_CHANNEL'), threadId, threadKind: 'coding', threadOrigin: 'desktop', body: firstPrompt }) });
  if (!birth.ok) throw new Error(`Thread birth failed (${birth.status}): ${await birth.text()}`);
  const shared = { NM_BRAIN_TEST_THREAD: threadId };
  await runDevice({ ...shared, NM_BRAIN_TEST_DEVICE: 'a', NM_BRAIN_TEST_PROFILE: join(root, 'device-a'), NM_BRAIN_TEST_MODEL: process.env['NM_BRAIN_TEST_MODEL_A'] ?? 'claude-opus-4-5-20251101', NM_BRAIN_TEST_PROMPT: firstPrompt });
  const head = await fetch(`${apiUrl}/v1/brain/threads/${threadId}?workspace=${workspace}`, { headers });
  assert.equal(head.status, 200);
  const snapshot = await head.json() as { revision: number; events: unknown[]; runtimeMessages: unknown[]; artifacts: Array<{ id: string; sha256: string }> };
  assert.ok(snapshot.events.length > 10); assert.ok(snapshot.runtimeMessages.length > 1); assert.ok(snapshot.artifacts.length > 0);
  await runDevice({ ...shared, NM_BRAIN_TEST_DEVICE: 'b', NM_BRAIN_TEST_PROFILE: join(root, 'device-b'), NM_BRAIN_TEST_MODEL: process.env['NM_BRAIN_TEST_MODEL_B'] ?? 'gpt-5.4', NM_BRAIN_TEST_PROMPT: 'Continue the existing conversation on this second device. What exact private passphrase did I ask you to remember? Read .nm-artifacts/proof.svg and report its visible label. Do not edit it. Answer with the exact passphrase and the SVG label.' });
  const first = JSON.parse(readFileSync(join(root, 'device-a', 'result.json'), 'utf8'));
  const second = JSON.parse(readFileSync(join(root, 'device-b', 'result.json'), 'utf8'));
  assert.ok(second.answers.some((answer: string) => answer.includes(nonce)), 'The second provider must recall the conversation-only passphrase');
  assert.equal(first.sha256, second.sha256, 'The artifact must be byte-identical on the new device');
  const downloaded = await fetch(`${apiUrl}/v1/brain/artifacts/${snapshot.artifacts[0]!.id}?workspace=${workspace}`, { headers });
  assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), first.sha256);
  const proof = { ok: true, threadId, workspace, root, firstModel: first.model, secondModel: second.model, checkpointRevision: snapshot.revision, eventCount: snapshot.events.length, runtimeMessageCount: snapshot.runtimeMessages.length, artifactId: snapshot.artifacts[0]!.id, sha256: first.sha256, passphraseRecovered: true, distinctNativeHistory: true };
  writeFileSync(join(root, 'proof.json'), JSON.stringify(proof, null, 2));
  process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
