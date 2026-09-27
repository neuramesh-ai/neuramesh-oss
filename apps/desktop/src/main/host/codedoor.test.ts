// THE CODE DOOR (0144, door 2): open_code_session is in the triage registry exactly when its gates hold —
// a conversation (never a task thread) whose kind is not coding yet, in a room whose project has a
// repository. The manifest test (orchregistry.test.ts) builds with an empty replica and so never sees
// it; this one answers the two replica reads the gate makes. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/codedoor.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeOrchTools } from './orchtools';

const REPO = { id: 'r-app', org_name: 'flowe', name: 'app', clone_url: 'https://github.com/flowe/app', local_path: null, provider: 'github' };

/** a replica that answers the gate's two reads: the room's repository, and the conversation's kind */
function replica(o: { repo: boolean; kind: string | null }) {
  return {
    getAll: async (sql: string) => {
      if (/from repos r/.test(sql)) return o.repo ? [REPO] : [];
      if (/select kind from threads/.test(sql)) return o.kind === null ? [] : [{ kind: o.kind }];
      return [];
    },
  };
}

async function registry(o: { repo: boolean; kind: string | null; task?: boolean }) {
  const never = async (): Promise<never> => { throw new Error('the tools are weighed, never run'); };
  const host = makeOrchTools({
    db: replica(o) as never,
    post: never,
    agents: new Map(),
    apiGet: never,
    brain: {} as never,
    buildScheduleCard: () => '',
    draftsForAnchor: async () => null,
    ensureChatWorkspace: () => '/tmp/codedoor',
    executeHire: never,
    generateDraftImage: never,
    libraryDocs: async () => [],
    startDeepWork: async () => null,
    subjectFor: () => null,
    whiteboardClosures: () => ({ list: never, read: never, create: never, update: never }) as never,
    workspaceListing: () => [],
    workspaceRead: () => ({ ok: false as const, error: 'stub' }),
  } as never);
  const tools = await host.buildOrchestratorTools({
    ch: { id: 'c-dev', slug: 'dev', workspace_id: 'ws' },
    agent: { id: 'a-rex', name: 'rex', role: 'orchestrator', runtime: 'claude-code' } as never,
    actor: { kind: 'agent', id: 'a-rex', role: 'orchestrator' },
    skills: [],
    thread: o.task ? { id: 't-1', number: 1046, title: 'a unit', state: 'in_progress' } : undefined,
    convoThreadId: o.task ? null : 'th-1',
    token: '',
    kind: o.task ? 'own' : 'triage',
    spawn: async () => ({ ok: false, error: 'stub' }),
  });
  return tools.map((t) => t.name);
}

test('the door opens on a conversation in a room with a repository', async () => {
  assert.ok((await registry({ repo: true, kind: 'chat' })).includes('open_code_session'));
});

test('no repository on the project: no door — the model never sees a tool that would refuse it', async () => {
  assert.ok(!(await registry({ repo: false, kind: 'chat' })).includes('open_code_session'));
});

test('a thread that is already coding has no door to walk through twice', async () => {
  assert.ok(!(await registry({ repo: true, kind: 'coding' })).includes('open_code_session'));
});

test('a task thread never gets the door: its unit IS the code path', async () => {
  assert.ok(!(await registry({ repo: true, kind: 'chat', task: true })).includes('open_code_session'));
});

test('a legacy thread with no kind row reads as chat, so the door opens', async () => {
  assert.ok((await registry({ repo: true, kind: null })).includes('open_code_session'));
});
