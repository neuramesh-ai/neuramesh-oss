import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { roomOverrides } from './webnm-rooms';

const cfg = {
  apiUrl: '',
  powersyncUrl: '',
  clerkSessionId: async () => null,
  clerkBearer: async () => null,
  relayBearer: async () => null,
  actorId: () => 'u1',
  workspaceId: () => 'w1',
};

describe('web room metadata', () => {
  test('exposes project and workspace repo identities for remote Engineering machines', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      getAll: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes('join project_repos pr')) {
          return [{ id: 'r-project', org_name: 'acme', name: 'app', default_branch: 'main', local_path: null }];
        }
        if (sql.includes('r.workspace_id = c.workspace_id')) {
          return [{ id: 'r-all', org_name: 'acme', name: 'infra', default_branch: 'main', local_path: null }];
        }
        return [{ id: 'p1', name: 'Default', slug: 'default', is_default: 1 }];
      },
    };

    const result = await roomOverrides(cfg, db as never).channelMeta!('channel-1');

    assert.deepEqual(result.projects.map((row) => row.id), ['p1']);
    assert.deepEqual(result.repos.map((row) => row.id), ['r-project']);
    assert.deepEqual(result.reposAll.map((row) => row.id), ['r-all']);
    assert.equal(calls.length, 3);
    assert.ok(calls[1]!.sql.includes('join project_repos'));
    assert.ok(calls[2]!.sql.includes('where r.workspace_id = c.workspace_id'));
    assert.deepEqual(calls.map((call) => call.params), [['channel-1'], ['channel-1'], ['channel-1']]);
  });

  test('reports a broken repo read and degrades only that list', async () => {
    const db = {
      getAll: async (sql: string) => {
        if (sql.includes('join project_repos pr')) throw new Error('replica unavailable');
        return [];
      },
    };
    const errors: unknown[] = [];
    const real = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const result = await roomOverrides(cfg, db as never).channelMeta!('channel-1');
      assert.deepEqual(result.repos, []);
      assert.deepEqual(result.reposAll, []);
    } finally {
      console.error = real;
    }
    assert.equal(errors.length, 1);
    assert.match(String((errors[0] as unknown[])[0]), /channelMeta\.repos failed/);
  });
});
