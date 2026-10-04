// THE GITHUB CARD AND THE THOUGHTS BLOCK, IN THE HARNESS (docs/design/repo-connect-2026-10/plan.md): rex's side of
// the flow, scripted so a capture walks it the same way every time.
//   · A send that asks about the storage adapters gets rex's thoughts first (the live Thoughts block, a tool step
//     line in it), then the lead line and the GitHub card with its open Needs-you row, as the tool posts them
//     (host/reponeed.ts), then rex's one short line.
//   · A resolve that answers connected runs the server's resume (control-api github-resume.ts): the card's row
//     closes, the person's ‹github:connected:…› divider posts in its thread, and rex continues the ask, thoughts
//     first. The card itself flips on its own resolve, as it does live.
//   · `?codegate=github` seeds a coding thread in Flowe AI's #dev, whose project holds a desktop folder. Its
//     machine refuses the open with ENGINEERING_GITHUB_REQUIRED until a GitHub row lands, so the gate's faces and
//     the reopen run through the real reducer (shared engineering/remote.ts). `?codegate=stuck`: the room is
//     connected and the machine still refuses, the shape that looped the gate. `?codegate=norepo`: the project
//     holds no repository, so the gate's pick attaches one and the room's repositories read again open the session.
//     Opens are counted on window.
// Kept apart from mock-nm.ts, which sits at its size cap.
import { GITHUB_NEED_PREFIX, githubConnectedMarker, needBlock, needDecisionQuestion, parseNeed, type EngineeringOpenMeta, type EngineeringRuntimeEvent } from '@neuramesh/shared';
import { channels, convoMsgs, mockConnectors, mockDecisions, mockThreads, pingConvo, pingDecisions, pingThreads, qp, streamWatchers } from './mock-fixtures';

const ASK = /storage (interface|adapters?)/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stream = (key: string, text: string, thinking: string, done = false) => streamWatchers.forEach((cb) => cb({ key, agent: 'rex', text, done, ...(thinking ? { thinking } : {}) }));
const githubOn = () => mockConnectors.some((c) => c.provider === 'github' && c.status === 'connected');

function post(channelId: string, th: string, author: { kind: 'agent' | 'human'; id: string }, body: string): string {
  const id = `rc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const at = new Date().toISOString();
  (convoMsgs[th] ??= []).push({ id, author_kind: author.kind, author_id: author.id, created_at: at, body });
  const tr = (mockThreads[channelId] ?? []).find((x) => x.id === th) as Record<string, unknown> | undefined;
  if (tr) Object.assign(tr, { updated_at: at, last_body: body, last_author_kind: author.kind, msg_count: Number(tr['msg_count'] ?? 0) + 1 });
  pingThreads(channelId); pingConvo(th);
  return id;
}

/** one turn as the live stream draws it: the thoughts grow, then the words, then the row lands */
async function turn(channelId: string, th: string, thoughts: string[], words: string, beforeWords?: () => void): Promise<void> {
  const key = `${channelId}:${th}`;
  let so = '';
  for (const t of thoughts) { so = so ? `${so}\n\n${t}` : t; stream(key, '', so); await sleep(900); }
  beforeWords?.();
  const parts = words.split(' ');
  for (let i = 1; i <= parts.length; i += 3) { stream(key, parts.slice(0, i).join(' '), so); await sleep(160); }
  stream(key, words, so);
  await sleep(1400);
  stream(key, '', '', true);
  post(channelId, th, { kind: 'agent', id: 'a-rex' }, words);
}

/** rex's arc for a send into thread `th`: true when it answered, so the default arc stands down */
export function repoConnectArc(channelId: string, th: string, tr: { title?: string }, body: string): boolean {
  if (!ASK.test(body) || githubOn()) return false;
  const room = channels.find((c) => c.id === channelId);
  const repo = room?.project_id === 'p-flowe' ? 'flowe-mobile' : 'marketing-site';
  void turn(channelId, th, [
    'The ask is about the storage adapters. I read the adapter files before I answer.',
    '› list_repo_files · src/storage',
    `Nothing here can read ${repo} yet. A GitHub card asks for the grant. I stop and wait.`,
  ], 'I wait for GitHub. I continue here when it is connected.', () => {
    // the tool's card (host/reponeed.ts postRepoNeed): the lead line, the card, and the row the server mints
    const card = needBlock({ channel: channelId, ask: tr.title || 'This conversation', why: `This conversation reads the code in ${repo}. Nothing ran yet.`, connect: ['github'], after: 'rex continues here when GitHub is connected.' });
    const id = post(channelId, th, { kind: 'agent', id: 'a-rex' }, `I need to read the code in ${repo} for this, and nothing here can read it yet.\n\n${card}`);
    const question = needDecisionQuestion(parseNeed(card)!);
    mockDecisions.push({
      id: `d-${id}`, channel_id: channelId, task_id: null, message_id: id, thread_id: th, asker_kind: 'agent', asker_id: 'a-rex', question,
      options: '[]', allow_other: 0, status: 'open', answer: null, created_at: new Date().toISOString(), answered_at: null, human_replied_at: null, channel_slug: room?.slug ?? 'dev', task_number: null,
    });
    pingDecisions();
  });
  return true;
}

/** the server's resume (github-resume.ts), on every connected answer: it finds nothing the second time */
function resume(slug: string): void {
  for (const d of mockDecisions.filter((x) => x.status === 'open' && String(x.question).startsWith(GITHUB_NEED_PREFIX))) {
    Object.assign(d, { status: 'answered', answer: `Connected ${slug}`, answered_at: new Date().toISOString() });
    post(d.channel_id, d.thread_id, { kind: 'human', id: 'u-george' }, githubConnectedMarker(slug));
    // the divider wakes rex in that thread, and its transcript reads "the person connected GitHub". A
    // coding thread wakes no agent: its runtime takes the work (the gate's reopen)
    if ((mockThreads[d.channel_id] ?? []).find((x) => x.id === d.thread_id)?.kind === 'coding') continue;
    setTimeout(() => void turn(d.channel_id, d.thread_id, [
      `GitHub is connected: ${slug}. I continue the ask.`,
      '› list_repo_files · src/storage',
      '› read_repo_file · src/storage/adapter.ts',
      'Three adapters share one interface. The SQLite adapter skips the batch write the other two have.',
    ], 'The storage interface has three adapters: SQLite, the file store and the cloud store. All three implement `StorageAdapter` in `src/storage/adapter.ts`. The SQLite adapter has no `writeBatch`, so it writes rows one by one. That is the slow path the sync reports show.'), 600);
  }
  pingDecisions();
}

/** the resolve with the server's resume behind it, as github-resolve.ts written() runs it */
export function resolveWithResume<R extends { ok: boolean }>(inner: (channelId: string, repo?: string) => Promise<R>): (channelId: string, repo?: string) => Promise<R> {
  return async (channelId, repo) => {
    const r = await inner(channelId, repo);
    // a project with no repository has no folder to name: the server sends no hint (github-resolve.ts hintFor)
    if (NO_REPO && !r.ok) return { ...r, hint: null, error: 'Pick the repository this project lives in.' };
    // the pick attaches the repository to the project (github-resolve.ts attach), before the gate reads the room again
    if (NO_REPO && repo && r.ok && !attached.length) attached.push({ id: 'r-gh-flowe', provider: 'github', org_name: 'alonge-dev', name: 'flowe-mobile', default_branch: 'main', local_path: null, project_ids: 'p-flowe', primary_project_ids: 'p-flowe' });
    if (r.ok && 'handle' in r) resume(String(r.handle));
    return r;
  };
}

// ── ?codegate=github: the coding thread whose machine cannot reach its code ─────────────────────────────────
const GATE_SEED = qp('codegate');
const NO_REPO = GATE_SEED === 'norepo';
const CODE_GATE = GATE_SEED === 'github' || GATE_SEED === 'stuck' || NO_REPO;
const STUCK = GATE_SEED === 'stuck';
type RepoUIRow = { id: string; provider: string; org_name: string; name: string; default_branch: string; local_path: string | null; project_ids: string; primary_project_ids: string };
const attached: RepoUIRow[] = [];
/** the room's repositories as channelMeta reads them: under norepo, Flowe AI holds none until the pick attaches one */
export function codeGateRepos<R extends { project_ids: string }>(repos: R[]): R[] {
  return NO_REPO ? [...repos.filter((r) => !r.project_ids.split(',').includes('p-flowe')), ...(attached as unknown as R[])] : repos;
}
if (STUCK) mockConnectors.push({ id: 'conn-gh', provider: 'github', handle: 'alonge-dev/flowe-mobile', status: 'connected' });
const opened = (): void => { if (typeof window !== 'undefined') { const w = window as unknown as { __nmEngineeringOpens?: number }; w.__nmEngineeringOpens = (w.__nmEngineeringOpens ?? 0) + 1; } };
export const CODE_GATE_THREAD = 'th-coding-gate';
const ROOT = 'Map the storage adapters in flowe-mobile and find why the SQLite one is slow.';
if (CODE_GATE) {
  // what the live run showed (2026-10-03): rex posts the GitHub card, then opens a code session on the
  // same ask, so the thread turns to code with the card above the root. The gate seat must hold it alone
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  (mockThreads['cf-dev'] ??= []).unshift({ id: CODE_GATE_THREAD, title: 'Map the storage adapters', description: '', created_by: 'human:u-george', task_id: null, mode: 'tasks', kind: 'coding', created_at: ago(20_000), updated_at: ago(17_000), msg_count: 4, last_body: 'The coding session starts here.', last_author_kind: 'agent', last_at: ago(17_000) } as never);
  const card = needBlock({ channel: 'cf-dev', ask: 'Map the storage adapters', why: 'This conversation reads the code in flowe-mobile. Nothing ran yet.', connect: ['github'], after: 'rex continues here when GitHub is connected.' });
  convoMsgs[CODE_GATE_THREAD] = [
    { id: 'm-gate-root', author_kind: 'human', author_id: 'u-george', body: ROOT, created_at: ago(20_000) },
    { id: 'm-gate-card', author_kind: 'agent', author_id: 'a-rex', body: `I need to read the code in flowe-mobile for this, and nothing here can read it yet.\n\n${card}`, created_at: ago(19_000) },
    { id: 'm-gate-kind', author_kind: 'agent', author_id: 'a-rex', body: '‹kind:coding›', created_at: ago(18_000) },
    { id: 'm-gate-line', author_kind: 'agent', author_id: 'a-rex', body: 'The coding session starts here.', created_at: ago(17_000) },
  ];
  mockDecisions.push({ id: 'd-m-gate-card', channel_id: 'cf-dev', task_id: null, message_id: 'm-gate-card', thread_id: CODE_GATE_THREAD, asker_kind: 'agent', asker_id: 'a-rex', question: needDecisionQuestion(parseNeed(card)!),
    options: '[]', allow_other: 0, status: 'open', answer: null, created_at: ago(19_000), answered_at: null, human_replied_at: null, channel_slug: 'dev', task_number: null });
}

const agentEvent = (event: Record<string, unknown>): EngineeringRuntimeEvent => ({ type: 'agent_event', event: { type: 'agent_event', payload: { event } } }) as never;
/** the machine side of one coding turn: thoughts, one read, the words, the end */
async function codeTurn(emit: (e: EngineeringRuntimeEvent) => void): Promise<void> {
  emit({ type: 'status', status: 'running' } as never);
  for (const r of ['The person asks for the storage adapters. ', 'I list src/storage first, then read the interface.']) { emit(agentEvent({ type: 'content_start', contentType: 'reasoning', reasoning: r })); await sleep(700); }
  emit(agentEvent({ type: 'content_start', contentType: 'tool', toolName: 'read_files', input: { paths: ['src/storage/adapter.ts'] } }));
  await sleep(900);
  emit(agentEvent({ type: 'content_end', contentType: 'tool', toolName: 'read_files' }));
  const words = 'Three adapters implement `StorageAdapter`. The SQLite adapter has no `writeBatch`, so each row is one write. I can add the batch write in Act mode.';
  for (let i = 12; i < words.length; i += 12) { emit(agentEvent({ type: 'content_start', contentType: 'text', text: '', accumulated: words.slice(0, i) })); await sleep(120); }
  emit(agentEvent({ type: 'content_end', contentType: 'text', text: words }));
  emit({ type: 'ended', reason: 'completed' } as never);
}

/** the coding runtime's two lanes, live only under ?codegate=github (else the bridge's fallback answers) */
export const codeGateLanes = CODE_GATE ? {
  engineeringInfo: async () => ({ available: true }),
  openEngineering: (meta: EngineeringOpenMeta, onEvent: (e: EngineeringRuntimeEvent) => void, _onExit: () => void) => {
    let closed = false;
    opened();
    const emit = (e: EngineeringRuntimeEvent) => { if (!closed) onEvent(e); };
    // the machine's clone (relay/engineering-workspace.ts): a folder from a desktop has no clone, and no grant reads its GitHub copy
    if (githubOn() && !STUCK) setTimeout(() => emit({ type: 'ready', provider: 'openai', model: 'gpt-5.6-sol' } as never), 200);
    else setTimeout(() => emit({ type: 'error', code: 'ENGINEERING_GITHUB_REQUIRED', message: `${meta.repoName} has no copy this machine can clone.` } as never), 700);
    return {
      subId: `sub-${meta.threadId}`,
      send: async (cmd: { type: string }) => { if (cmd.type === 'prompt' && githubOn() && !STUCK) void codeTurn(emit); },
      close: () => { closed = true; },
    };
  },
} : {};
