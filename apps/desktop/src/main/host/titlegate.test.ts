// a schedule's session wears its schedule's title (docs/design/routine-sessions-2026-09, PR 2): the server
// names the session and refuses an agent's name for it, so the triage registry never offers
// set_thread_title there, and a person's conversation keeps it. Run from apps/desktop:
// pnpm exec tsx --test src/main/host/titlegate.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeOrchTools } from './orchtools';

async function registry(scheduleId: string | null) {
  const never = async (): Promise<never> => { throw new Error('the tools are weighed, never run'); };
  const db = { getAll: async (sql: string) => (/select schedule_id from threads/.test(sql) ? [{ schedule_id: scheduleId }] : []) };
  const host = makeOrchTools({
    db: db as never, post: never, agents: new Map(), apiGet: never, brain: {} as never, buildScheduleCard: () => '',
    draftsForAnchor: async () => null, ensureChatWorkspace: () => '/tmp/titlegate', executeHire: never, generateDraftImage: never,
    libraryDocs: async () => [], startDeepWork: async () => null, subjectFor: () => null,
    whiteboardClosures: () => ({ list: never, read: never, create: never, update: never }) as never,
    workspaceListing: () => [], workspaceRead: () => ({ ok: false as const, error: 'stub' }),
  } as never);
  const tools = await host.buildOrchestratorTools({
    ch: { id: 'c-dev', slug: 'dev', workspace_id: 'ws' },
    agent: { id: 'a-rex', name: 'rex', role: 'orchestrator', runtime: 'claude-code' } as never,
    actor: { kind: 'agent', id: 'a-rex', role: 'orchestrator' },
    skills: [], thread: undefined, convoThreadId: 'th-1', token: '', kind: 'triage',
    spawn: async () => ({ ok: false, error: 'stub' }),
  });
  return tools.map((t) => t.name);
}

test('a routine\'s session: no title tool, because the session carries its routine\'s title', async () => {
  assert.ok(!(await registry('s-audit')).includes('set_thread_title'));
});

test('a person\'s conversation: the orchestrator still names it once', async () => {
  assert.ok((await registry(null)).includes('set_thread_title'));
});
