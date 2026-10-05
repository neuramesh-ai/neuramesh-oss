import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTER_MODEL } from '@neuramesh/shared';
import { resolveEngineeringBrain } from './engineering-brain';

const opts = { apiUrl: 'https://api.test', machineToken: 'nmm_test', workspaceId: 'workspace-1' };

// George, 2026-10-04: a coding conversation runs the model picked for it, else the NeuraMesh brain. The
// developer seat and the project's pack no longer set it (a Gemini seat stranded the first prompt)
test('with no pick, Code runs the NeuraMesh brain, never the project developer brain', async () => {
  const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
  const db = { getAll: async <T>(sql: string, parameters?: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.includes('from agents')) return [{ id: 'patch-1', model: 'claude-sonnet-4-6', model_source: 'pack' } as T];
    return [{ model_pack: 'openai-core' } as T];
  } };
  assert.deepEqual(await resolveEngineeringBrain(db, opts, { repoId: 'repo-1' }), { modelId: STARTER_MODEL, agentId: 'patch-1' });
  assert.deepEqual(calls.find((call) => call.sql.includes('from projects'))?.parameters, ['workspace-1', 'repo-1', null, null]);
});

test('Engineering still checks the selected project against the repository', async () => {
  const calls: Array<unknown[] | undefined> = [];
  const db = { getAll: async <T>(sql: string, parameters?: unknown[]) => {
    calls.push(parameters);
    return [(sql.includes('from agents') ? { id: 'patch-1', model: 'claude-sonnet-4-6', model_source: 'pack' } : { model_pack: 'openai-core' }) as T];
  } };
  assert.deepEqual(await resolveEngineeringBrain(db, opts, { repoId: 'repo-1', projectId: 'project-2' }), { modelId: STARTER_MODEL, agentId: 'patch-1' });
  assert.deepEqual(calls[1], ['workspace-1', 'repo-1', 'project-2', 'project-2']);
});

test('Engineering rejects a project that is not connected to the selected repository', async () => {
  const db = { getAll: async <T>(sql: string) => sql.includes('from agents')
    ? [{ id: 'patch-1', model: 'claude-sonnet-4-6', model_source: 'pack' } as T]
    : [] as T[] };
  await assert.rejects(resolveEngineeringBrain(db, opts, { repoId: 'repo-1', projectId: 'foreign-project' }), /not connected to this repository/);
});

test('a manual developer pin no longer sets the Code model either', async () => {
  const db = { getAll: async <T>(sql: string) => [(sql.includes('from agents')
    ? { id: 'patch-1', model: 'claude-opus-4-8', model_source: 'manual' }
    : { model_pack: 'openai-core' }) as T] };
  assert.deepEqual(await resolveEngineeringBrain(db, opts, { repoId: 'repo-1' }), { modelId: STARTER_MODEL, agentId: 'patch-1' });
});

test('an explicit Engineering brain pack overrides normal seat and project inheritance', async () => {
  const db = { getAll: async <T>(sql: string) => [(sql.includes('from agents')
    ? { id: 'patch-1', model: 'claude-opus-4-8', model_source: 'manual' }
    : { model_pack: 'claude-core' }) as T] };
  assert.deepEqual(
    await resolveEngineeringBrain(db, opts, { repoId: 'repo-1', brainPack: 'openai-core' }),
    { modelId: 'gpt-5.6-terra', agentId: 'patch-1' },
  );
});

test('a direct Code model selection overrides pack and seat inheritance', async () => {
  const db = { getAll: async <T>(sql: string) => [(sql.includes('from agents')
    ? { id: 'patch-1', model: 'claude-opus-4-8', model_source: 'manual' }
    : { model_pack: 'claude-core' }) as T] };
  assert.deepEqual(
    await resolveEngineeringBrain(db, opts, { repoId: 'repo-1', modelId: 'gpt-5.6-sol', brainPack: 'claude-core' }),
    { modelId: 'gpt-5.6-sol', agentId: 'patch-1' },
  );
});

test('an invented direct Code model is rejected on the machine', async () => {
  const db = { getAll: async <T>() => [] as T[] };
  await assert.rejects(
    resolveEngineeringBrain(db, opts, { repoId: 'repo-1', modelId: 'invented-client-model' }),
    /selected Code model is not available/,
  );
});

test('an unavailable task-scoped brain pack is rejected on the machine', async () => {
  const db = { getAll: async <T>() => [] as T[] };
  await assert.rejects(
    resolveEngineeringBrain(db, opts, { repoId: 'repo-1', brainPack: 'invented-client-model' }),
    /selected Engineering brain is not available/,
  );
});

test('a custom brain pack is loaded through the authenticated control plane', async () => {
  let authorization = '';
  const db = { getAll: async <T>(sql: string) => [(sql.includes('from agents')
    ? { id: 'patch-1', model: 'claude-sonnet-4-6', model_source: 'pack' }
    : { model_pack: 'custom:brain-1' }) as T] };
  const resolved = await resolveEngineeringBrain(db, {
    ...opts,
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({ packs: [{ id: 'custom:brain-1', name: 'Project brain', roles: { developer: 'gemini-3.5-flash' } }] }));
    },
  }, { repoId: 'repo-1', brainPack: 'custom:brain-1' });
  assert.deepEqual(resolved, { modelId: 'gemini-3.5-flash', agentId: 'patch-1' });
  assert.equal(authorization, 'Bearer nmm_test');
});

test('an empty replica seat resolves to the Neuramesh starter brain instead of throwing', async () => {
  const db = { getAll: async <T>() => [] as T[] };
  assert.deepEqual(await resolveEngineeringBrain(db, opts, { repoId: 'repo-1' }), { modelId: 'gemini-3.5-flash-lite' });
});
