import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineeringSession } from './domain';
import {
  engineeringSessionStorageReady,
  engineeringSessionStoreKey,
  loadEngineeringSessions,
  persistEngineeringSessions,
} from './session-storage';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('legacy Code history migrates once into the matching workspace without deleting its source', () => {
  const storage = new MemoryStorage();
  const repoA = { id: 'repo-a', name: 'alpha', owner: 'acme', branch: 'main', root: '/alpha' };
  const repoB = { id: 'repo-b', name: 'beta', owner: 'acme', branch: 'main', root: '/beta' };
  const alpha = { ...createEngineeringSession(repoA, 'Alpha task'), messages: [{ ...createEngineeringSession(repoA).messages[0]!, streaming: true }] };
  const beta = createEngineeringSession(repoB, 'Beta task');
  storage.setItem('nm:engineering:sessions:v2', JSON.stringify([alpha, { malformed: true }, beta]));

  assert.deepEqual(loadEngineeringSessions('workspace-a', [repoA], storage).map((session) => session.title), ['Alpha task']);
  assert.deepEqual(loadEngineeringSessions('workspace-b', [repoB], storage).map((session) => session.title), ['Beta task']);
  assert.equal(loadEngineeringSessions('workspace-a', [repoA], storage)[0]?.messages[0]?.streaming, false);
  const persisted = JSON.parse(storage.getItem(engineeringSessionStoreKey('workspace-a')) ?? '{}') as { sessions?: unknown[] };
  assert.equal(persisted.sessions?.length, 1);
  assert.notEqual(storage.getItem('nm:engineering:sessions:v2'), null);
});

test('an unresolved empty workspace waits for repositories before migration and then becomes authoritative', () => {
  const storage = new MemoryStorage();
  const repo = { id: 'repo-a', name: 'alpha', owner: 'acme', branch: 'main', root: '/alpha' };
  storage.setItem('nm:engineering:sessions:v2', JSON.stringify([createEngineeringSession(repo, 'Alpha task')]));

  assert.deepEqual(loadEngineeringSessions('workspace-a', [], storage), []);
  assert.equal(engineeringSessionStorageReady('workspace-a', storage), false);
  assert.equal(storage.getItem(engineeringSessionStoreKey('workspace-a')), null);

  assert.deepEqual(loadEngineeringSessions('workspace-a', [repo], storage).map((session) => session.title), ['Alpha task']);
  assert.equal(engineeringSessionStorageReady('workspace-a', storage), true);
  assert.deepEqual(loadEngineeringSessions('workspace-a', [repo], storage).map((session) => session.title), ['Alpha task']);
});

test('legacy history never migrates by a fuzzy repository name or path match', () => {
  const storage = new MemoryStorage();
  const source = { id: 'repo-source', name: 'alpha', owner: 'acme', branch: 'main', root: '/shared/alpha' };
  const destination = { ...source, id: 'repo-destination' };
  storage.setItem('nm:engineering:sessions:v2', JSON.stringify([createEngineeringSession(source, 'Source task')]));

  assert.deepEqual(loadEngineeringSessions('workspace-destination', [destination], storage), []);
  assert.equal(engineeringSessionStorageReady('workspace-destination', storage), true);
  persistEngineeringSessions('workspace-destination', [], storage);
  assert.deepEqual(loadEngineeringSessions('workspace-destination', [destination], storage), []);
});

test('quota pressure falls back to metadata while preserving every thread identity', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > 1_500) throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      values.set(key, value);
    },
  };
  const repo = { id: 'repo-a', name: 'alpha', owner: 'acme', branch: 'main', root: '/alpha' };
  const sessions = ['one', 'two'].map((id) => ({
    ...createEngineeringSession(repo, `Task ${id}`), id,
    messages: [{ ...createEngineeringSession(repo).messages[0]!, body: 'x'.repeat(2_000) }],
  }));

  assert.equal(persistEngineeringSessions('workspace-a', sessions, storage), 'metadata');
  const restored = loadEngineeringSessions('workspace-a', [repo], storage);
  assert.deepEqual(restored.map(({ id, title }) => ({ id, title })), [{ id: 'one', title: 'Task one' }, { id: 'two', title: 'Task two' }]);
  assert.deepEqual(restored.map((session) => session.messages), [[], []]);
});
