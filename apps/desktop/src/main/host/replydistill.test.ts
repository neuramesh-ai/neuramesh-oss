// The reply-card guarantee (replydistill.ts): production ran the engage playbook and the
// drafted replies never left the report — the worker's draft_replies call died and nothing
// noticed. These pin the fallback: extraction through the ONE writer (cleanReplies strips a
// web row's invented metrics), the born-of-this-run dedupe, and the finish lane actually
// carrying it for a deliversReplies playbook.
import test from 'node:test';
import assert from 'node:assert/strict';
import { distillReplyCard } from './replydistill';
import { finishLeanUnit } from './leanunits';

const REPORT = {
  name: 'engage-report-2026-08-26.md',
  content: '# Reply radar — flowe.ai\n\n## Ranked candidates\n(the fixture model below answers for this)',
};

const EXTRACTED = JSON.stringify({
  baseline: '@joinflowe: 7 recent X posts, 2–7 impressions each',
  replies: [
    {
      target: {
        handle: '@matthew_labosco', url: 'https://x.com/matthew_labosco/status/123',
        platform: 'x', source: 'connector', age: '14h',
        text: 'Breathing apps and sleep hygiene are the new supplements…',
        metrics: { impressions: 75464, likes: 231 },
      },
      draft: 'Love this framing — we built flowe around exactly that.',
      why: 'names flowe\'s exact objection',
    },
    {
      target: {
        handle: '@hbr', url: 'https://www.linkedin.com/posts/hbr_focus-456',
        platform: 'linkedin', source: 'web',
        text: 'Deep work is dying in the notification economy…',
        // a model inventing numbers for a web row is exactly what the shape guard exists for
        metrics: { impressions: 9999 },
      },
      draft: 'The notification economy point matches what we see in resets.',
    },
  ],
});

function harness(opts: { dupe?: boolean; completeWith?: string } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const db = {
    get: async <T,>(sql: string): Promise<T | undefined> => {
      if (sql.includes("body like '%nmreply%'")) return (opts.dupe ? { id: 'm-old' } : undefined) as T | undefined;
      return undefined;
    },
  };
  const post = async (path: string, _actor: unknown, body: unknown) => {
    posts.push({ path, body: body as Record<string, unknown> });
    return { ok: true, status: 200, text: async () => '', json: async () => ({ message: { id: 'm9' } }) };
  };
  const complete = async (system: string) => {
    if (system.includes('reply-radar report')) return opts.completeWith ?? EXTRACTED;
    return '[]'; // the next-steps extractor finds nothing in these fixtures
  };
  return { posts, db, post, complete };
}

const fence = (body: string): { items: Array<Record<string, any>>; report?: string; baseline?: string } => {
  const m = /```nmreply\n([\s\S]+?)\n```/.exec(body);
  assert.ok(m, `no nmreply fence in: ${body.slice(0, 120)}`);
  return JSON.parse(m![1]!);
};

void test('distills the card from the report — web rows lose their invented metrics', async () => {
  const h = harness();
  await distillReplyCard(h.db, h.post, h.complete, 'm', 'tok', { kind: 'agent', id: 'rex' },
    REPORT, { id: 'ch1', workspace_id: 'ws1' }, 'task1', { threadId: 'th1' });
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0]!.body['threadId'], 'th1');
  const data = fence(String(h.posts[0]!.body['body']));
  assert.equal(data.report, REPORT.name);
  assert.equal(data.baseline, '@joinflowe: 7 recent X posts, 2–7 impressions each');
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0]!['letter'], 'A');
  assert.equal(data.items[0]!['target'].metrics.impressions, 75464);
  assert.equal(data.items[1]!['target'].source, 'web');
  assert.equal(data.items[1]!['target'].metrics, undefined);
});

void test('a card born of this run suppresses the fallback', async () => {
  const h = harness({ dupe: true });
  await distillReplyCard(h.db, h.post, h.complete, 'm', 'tok', { kind: 'agent', id: 'rex' },
    REPORT, { id: 'ch1', workspace_id: 'ws1' }, 'task1', { taskId: 'task1' });
  assert.equal(h.posts.length, 0);
});

void test('garbage extraction or zero replies costs the card, never throws', async () => {
  for (const completeWith of ['not json at all', '{"replies": []}']) {
    const h = harness({ completeWith });
    await distillReplyCard(h.db, h.post, h.complete, 'm', 'tok', { kind: 'agent', id: 'rex' },
      REPORT, { id: 'ch1', workspace_id: 'ws1' }, 'task1', { taskId: 'task1' });
    assert.equal(h.posts.length, 0);
  }
});

void test('the finish lane guarantees the card for a deliversReplies playbook — and only then', async () => {
  for (const [playbook, wantCard] of [['engage', true], [null, false]] as const) {
    const h = harness();
    await finishLeanUnit(
      h.db, h.post, { kind: 'agent', id: 'plume' },
      { id: 'task1', number: 1081, title: 'Reply radar, flowe.ai' }, { id: 'ch1', workspace_id: 'ws1' },
      'plume', 'done', [{ kind: 'doc', name: REPORT.name, content: REPORT.content }], 1,
      () => {}, { complete: h.complete, model: 'm', token: 'tok' }, playbook,
    );
    const cards = h.posts.filter((p) => p.path === '/v1/messages' && String(p.body['body']).includes('nmreply'));
    assert.equal(cards.length, wantCard ? 1 : 0, `playbook=${playbook}`);
  }
});
