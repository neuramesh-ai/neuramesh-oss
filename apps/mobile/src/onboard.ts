// THE WIZARD'S SIDE EFFECTS (S6): the workspace minted at the first step, the runner row waited
// for through the usage route (a DB read, not a sync wait — the replica catches up on its own),
// the crew registered from the shared command list, and the two SecureStore marks: an unfinished
// wizard's workspace (so a relaunch resumes rather than minting twice — the browser's
// resumeWorkspaceId rule) and the workspace just joined (so Home shows the join moment once).
import { launchCommands, type WizardState } from '@neuramesh/shared';
import * as SecureStore from 'expo-secure-store';
import { api } from './auth';

const RESUME_KEY = 'nm.onboarding.workspace';
const JOINED_KEY = 'nm.onboarding.joined';

/** the unfinished wizard's workspace — its id, and the name and address the human chose, so a
 *  resumed wizard says the right name rather than suggesting a new one */
export interface ResumeMark { id: string; name: string; slug: string }
export const readResume = (): Promise<ResumeMark | null> => SecureStore.getItemAsync(RESUME_KEY).then((raw) => {
  if (!raw) return null;
  try { const m = JSON.parse(raw) as Partial<ResumeMark>; return m.id ? { id: m.id, name: m.name ?? '', slug: m.slug ?? '' } : null; } catch { return { id: raw, name: '', slug: '' }; }
}).catch(() => null);
export const writeResume = (mark: ResumeMark): Promise<void> => SecureStore.setItemAsync(RESUME_KEY, JSON.stringify(mark)).catch(() => {});
export const clearResume = (): Promise<void> => SecureStore.deleteItemAsync(RESUME_KEY).catch(() => {});
export const readJoined = (): Promise<string | null> => SecureStore.getItemAsync(JOINED_KEY).catch(() => null);
export const writeJoined = (id: string): Promise<void> => SecureStore.setItemAsync(JOINED_KEY, id).catch(() => {});
export const clearJoined = (): Promise<void> => SecureStore.deleteItemAsync(JOINED_KEY).catch(() => {});

/** an error said in one line (the desktop's errMsg), never the raw envelope */
export const errMsg = (e: unknown): string => (e instanceof Error && e.message ? e.message.replace(/^\/v1\/commands failed \d+: /, '').slice(0, 140) : 'Something went wrong.');

/** the workspace is born here — the id the fleet provisions the cloud machine against */
export async function createWorkspace(name: string, slug: string): Promise<string> {
  const res = (await api.command({ type: 'workspace.create', name, slug })) as unknown as { workspaceId?: string };
  if (!res?.workspaceId) throw new Error('The server did not return a workspace id.');
  return res.workspaceId;
}

export interface RunnerRow { id: string; name: string; lifecycle: string | null; lastSeenAt: string | null; desiredReplicas: number }

/** the workspace's cloud machine as the fleet lists it, or null while autoprovision is still minting the row */
export async function readRunner(workspaceId: string): Promise<RunnerRow | null> {
  const u = await api.machinesUsage(workspaceId).catch(() => null);
  const m = u?.machines.find((x) => x.kind === 'runner') ?? null;
  return m ? { id: m.id, name: m.name, lifecycle: m.lifecycle, lastSeenAt: m.lastSeenAt, desiredReplicas: m.desiredReplicas } : null;
}

/** wait for the runner ROW (as the browser does) — the pod may still be starting, which is fine:
 *  agents are rows, and the daemon claims them when it wakes */
export async function waitForRunner(workspaceId: string, timeoutMs = 45_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await readRunner(workspaceId);
    if (r) return r.id;
    if (Date.now() > deadline) return null;
    await new Promise((res) => setTimeout(res, 1500));
  }
}

export interface LaunchProgress { done: number; total: number; line: string }

/** Launch: the runner, then the shared command list in order. The pack, a subscription intent
 *  and the curator seat are best-effort exactly as the browser posts them; a key or a crew
 *  member that fails to land fails the launch, loud and specific — a silent "finish" would hand
 *  the human an empty workspace that looks complete. Registration is idempotent server-side, so
 *  a retry re-posts the whole list safely. */
export async function launchCrew(state: WizardState, workspaceId: string, onProgress?: (p: LaunchProgress) => void): Promise<{ machineId: string }> {
  onProgress?.({ done: 0, total: 1, line: 'Your cloud machine…' });
  const machineId = await waitForRunner(workspaceId);
  if (!machineId) throw new Error('Your cloud machine is not ready yet. Try again in a moment.');
  const cmds = launchCommands(state, workspaceId, machineId);
  let i = 0;
  for (const cmd of cmds) {
    i += 1;
    const line = cmd.type === 'workspace.update' ? 'The brain pack…' : cmd.type === 'credential.set' ? `Your ${cmd.provider} ${cmd.authMode === 'subscription' ? 'subscription' : 'key'}…` : cmd.type === 'agent.register' ? `Agent ${cmd.name}…` : 'One moment…';
    onProgress?.({ done: i, total: cmds.length, line });
    const soft = cmd.type === 'workspace.update' || (cmd.type === 'agent.register' && cmd.name === 'curator') || (cmd.type === 'credential.set' && cmd.authMode === 'subscription');
    try { await api.command(cmd); } catch (e) { if (!soft) throw e; }
  }
  onProgress?.({ done: cmds.length, total: cmds.length, line: 'Team ready' });
  return { machineId };
}

/** answer an invitation with a yes — the membership (and on Team the member's own machine) arrives through sync */
export async function acceptInvite(inviteId: string): Promise<{ workspaceId: string; workspaceName: string }> {
  const res = (await api.command({ type: 'workspace.accept_invite', invite: inviteId })) as unknown as { workspaceId: string; workspaceName: string };
  await writeJoined(res.workspaceId);
  return res;
}
