// The repo door (e2e-routes.ts POST /internal/e2e/workspaces/:id/repos): the stand-in for the GitHub
// App connect that the Cloud Run coding evals use. These tests hold its fences, because a door that
// writes repos.clone_url decides what code a cloud machine clones: only with NM_E2E_ROUTES=1 and the
// fleet secret, only a file:///nm/work/... URL, only into a room of that workspace, and only the
// row repo.link writes (store.linkRepo, provider git).
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { E2E_REPO_URL, e2eRoutes } from './e2e-routes';
import type { Store } from './store';

const WS = 'a5f0c2d8-1b3e-4f6a-8c9d-2e4f6a8c9d10';
const ROOM = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
const PROJECT = '660b9bc6-9304-4ed2-94dc-149778570d07';
const SECRET = 'fleet-test-secret';

/** a postgres.js stand-in: the channel lookup is the only query the door makes before linkRepo */
function fakeSql(rooms: Record<string, { workspace: string; project_id: string | null }>) {
  const calls: unknown[][] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    const text = strings.join('?');
    if (/from channels/.test(text)) {
      const [channel, ws] = values as [string, string];
      const r = rooms[channel];
      return Promise.resolve(r && r.workspace === ws ? [{ project_id: r.project_id }] : []);
    }
    return Promise.resolve([]);
  };
  return Object.assign(sql, { calls });
}

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = { NM_E2E_ROUTES: process.env['NM_E2E_ROUTES'], FLEET_SECRET: process.env['FLEET_SECRET'] };
  process.env['NM_E2E_ROUTES'] = '1';
  process.env['FLEET_SECRET'] = SECRET;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  vi.restoreAllMocks();
});

function setup(rooms: Record<string, { workspace: string; project_id: string | null }> = { [ROOM]: { workspace: WS, project_id: PROJECT } }) {
  const linkRepo = vi.fn(async () => ({ id: 'repo-1', inserted: true }));
  const store = { sql: fakeSql(rooms), linkRepo } as unknown as Store;
  const app = new Hono();
  e2eRoutes(app, store);
  const post = (body: unknown, auth = `Bearer ${SECRET}`, ws = WS) => app.request(`/internal/e2e/workspaces/${ws}/repos`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body),
  });
  return { linkRepo, post };
}

const GOOD = { channel: ROOM, name: 'eval-simple-abc123', cloneUrl: 'file:///nm/work/evals/eval-simple-abc123.git' };

describe('the e2e repo door', () => {
  it('writes what repo.link writes, as provider git, into the room\'s project', async () => {
    const { linkRepo, post } = setup();
    const res = await post(GOOD);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ repoId: 'repo-1', inserted: true, projectId: PROJECT, label: 'coding-evals/eval-simple-abc123' });
    expect(linkRepo).toHaveBeenCalledTimes(1);
    const [input, event] = linkRepo.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(input).toEqual({ workspace: WS, channel: ROOM, project: PROJECT, provider: 'git', orgName: 'coding-evals', name: 'eval-simple-abc123', defaultBranch: 'main', cloneUrl: GOOD.cloneUrl, localPath: null });
    expect(event).toMatchObject({ type: 'repo.linked', workspace: WS, target: 'resource/repo/coding-evals-eval-simple-abc123' });
  });

  it('is shut without NM_E2E_ROUTES=1 or without the fleet secret', async () => {
    const { linkRepo, post } = setup();
    expect((await post(GOOD, 'Bearer wrong')).status).toBe(403);
    expect((await post(GOOD, '')).status).toBe(403);
    process.env['NM_E2E_ROUTES'] = '0';
    expect((await post(GOOD)).status).toBe(403);
    expect(linkRepo).not.toHaveBeenCalled();
  });

  it('refuses a clone URL outside the machine work dir', async () => {
    const { linkRepo, post } = setup();
    for (const cloneUrl of [
      'https://github.com/a/b.git', 'file:///nm/state/x.git', 'file:///nm/work/../state/x.git', 'file:///nm/work/./x.git',
      'file:///etc/passwd', '/nm/work/x.git', 'file:///nm/work/', 'file:///nm/workspace/x.git', 'file:///nm/work/x y.git', 'ssh://h/nm/work/x.git',
    ]) expect((await post({ ...GOOD, cloneUrl })).status, cloneUrl).toBe(400);
    expect(linkRepo).not.toHaveBeenCalled();
  });

  it('refuses a room of another workspace, and a room with no project', async () => {
    const OTHER = 'df526f00-070e-4cff-a574-08c35aaad814';
    const NOPROJ = '11111111-2222-4333-8444-555555555555';
    const { linkRepo, post } = setup({ [OTHER]: { workspace: 'b0000000-0000-4000-8000-000000000000', project_id: PROJECT }, [NOPROJ]: { workspace: WS, project_id: null } });
    expect((await post({ ...GOOD, channel: OTHER })).status).toBe(404);
    expect((await post({ ...GOOD, channel: NOPROJ })).status).toBe(409);
    expect(linkRepo).not.toHaveBeenCalled();
  });

  it('refuses names that are not one path segment', async () => {
    const { post } = setup();
    for (const name of ['', '../x', 'a/b', '-x', 'x'.repeat(81)]) expect((await post({ ...GOOD, name })).status, name).toBe(400);
  });

  it('the URL rule names the work dir on a path boundary', () => {
    expect(E2E_REPO_URL.test('file:///nm/work/evals/a.git')).toBe(true);
    expect(E2E_REPO_URL.test('file:///nm/work/a.bundle')).toBe(true);
    expect(E2E_REPO_URL.test('file:///nm/workx/a.git')).toBe(false);
  });
});

// The intake door (round 9, the intake eval): the same decision a first message gets, with no thread
// and no write. With no starter key the build rule decides alone.
describe('the e2e intake door', () => {
  const door = () => {
    const app = new Hono();
    e2eRoutes(app, { sql: fakeSql({}) } as unknown as Store);
    return (body: unknown, auth = `Bearer ${SECRET}`) => app.request('/internal/e2e/intake', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body),
    });
  };
  let key: string | undefined;
  beforeEach(() => { key = process.env['STARTER_GOOGLE_API_KEY']; delete process.env['STARTER_GOOGLE_API_KEY']; });
  afterEach(() => { if (key !== undefined) process.env['STARTER_GOOGLE_API_KEY'] = key; });

  it('returns the decision, its effects and the rule, and writes nothing', async () => {
    const res = await door()({ workspace: WS, text: 'build a palindrome html app that checks if a string is a palindrome' });
    expect(res.status).toBe(200);
    const out = await res.json() as { decision: Record<string, unknown>; effects: Record<string, unknown>; rule: Record<string, unknown>; why: string };
    expect(out.decision).toMatchObject({ v: 1, kind: 'coding', source: 'rule', workspace: 'scratch' });
    expect(out.effects).toEqual({ kind: 'coding', workspaceMode: 'scratch', repoId: null });
    expect(out.rule).toMatchObject({ hit: true, verb: 'build' });
    expect(out.why).toBe('no_key');
  });

  it('a rule miss with no starter brain is no decision', async () => {
    const out = await (await door()({ workspace: WS, text: 'what is a palindrome?' })).json() as { decision: unknown };
    expect(out.decision).toBeNull();
  });

  it('is shut without the fleet secret, and refuses a body with no text', async () => {
    expect((await door()({ workspace: WS, text: 'build an app' }, 'Bearer wrong')).status).toBe(403);
    expect((await door()({ workspace: WS })).status).toBe(400);
  });
});
