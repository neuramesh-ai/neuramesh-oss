// A VERDICT CLOSES THE TASK'S OLDER CARDS (the needs-you round, George 2026-11-23). A question an
// agent asked about a gate ("what verdict should I apply to the plan?") outlived the verdict itself,
// so Needs you kept asking after the person had answered on the gate. When a person gives a task its
// verdict (approve or revise a plan or a design, request changes, approve or revise a release plan),
// or rex applies it on the person's word, the store dismisses the task's open question cards in the
// same transaction, as accept and close already do. A permission card (requires an exact answer) is
// no question about the gate, so it stays. A reviewer agent's request for changes is no person's verdict.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const patch: Actor = { kind: 'agent', id: 'patch', role: 'developer' };
const gem: Actor = { kind: 'agent', id: 'gem', role: 'reviewer' };

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const call = (path: string, actor: Actor, body: unknown) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body),
});
const send = (actor: Actor, body: unknown) => call('/v1/commands', actor, body);
type Card = { taskId: string | null; status: string; question: string; requiresExactAnswer?: boolean };
const cards = (taskId: string): Card[] => (store as unknown as { decisionRows: Card[] }).decisionRows.filter((d) => d.taskId === taskId);

async function ask(taskId: string, question: string) {
  const res = await call('/v1/messages', rex, { workspace: 'ws_acme', channel: 'dev', taskId, body: `\`\`\`nmq\n${JSON.stringify({ question, options: [{ label: 'Yes' }, { label: 'No' }] })}\n\`\`\`` });
  expect(res.status).toBeLessThan(300);
}
/** a permission card on the task: the kind that needs an exact answer */
function permission(taskId: string) {
  const rows = (store as unknown as { decisionRows: Array<Record<string, unknown>> }).decisionRows;
  rows.push({ ...rows.find((d) => d['taskId'] === taskId), id: `perm-${rows.length}`, question: 'Allow `git push`?', requiresExactAnswer: true, status: 'open' });
}
async function planned() {
  const res = await send(rex, {
    type: 'task.create', workspace: 'ws_acme', channel: 'dev', project: 'dev', title: 'pricing tiers', kind: 'feature',
    originThread: '5b1f0d3e-8f2a-4c6e-9d17-2a9b64c7e001', plan: { legs: ['build'], subtasks: [], approach: 'restyle the tier cards' },
  });
  return (await j(res)).task as { id: string; state: string };
}

beforeEach(() => { store = new MemoryStore(); app = createApp(store); });

describe('a verdict closes the task\'s older question cards', () => {
  it('a person\'s plan approval closes the question about the plan, and keeps a permission card', async () => {
    const t = await planned();
    await ask(t.id, 'What verdict should I apply to implementation-plan-v1.md?');
    permission(t.id);
    expect((await send(george, { type: 'task.approve_plan', taskId: t.id })).status).toBe(200);
    expect(cards(t.id).map((c) => [c.question.slice(0, 12), c.status])).toEqual([['What verdict', 'dismissed'], ['Allow `git p', 'open']]);
  });

  it('rex\'s revise on the person\'s word closes it too, and a card asked after the verdict stays open', async () => {
    const t = await planned();
    await ask(t.id, 'Approve the plan?');
    expect((await send(rex, { type: 'task.revise_plan', taskId: t.id, feedback: 'six tiers, not five' })).status).toBe(200);
    await ask(t.id, 'Which tier is the default?');
    expect(cards(t.id).map((c) => c.status)).toEqual(['dismissed', 'open']);
  });

  it('a reviewer agent\'s request for changes is no person\'s verdict, so the card stays', async () => {
    const res = await send(george, { type: 'task.create', workspace: 'ws_acme', channel: 'dev', title: 'fix mobile navigation', kind: 'feature', repo: { id: 'acme/marketing-site', baseRef: 'main' } });
    const t = (await j(res)).task as { id: string };
    await send(patch, { type: 'task.claim', taskId: t.id });
    await send(patch, { type: 'task.confirm_requirements', taskId: t.id, checklist: ['repro confirmed'] });
    await send(patch, { type: 'task.submit', taskId: t.id, artifacts: [{ kind: 'screenshot', name: 'after.png' }], sha: '8f3c2d1' });
    await ask(t.id, 'Ship it as is?');
    expect((await send(gem, { type: 'task.request_changes', taskId: t.id, feedback: 'focus trap must release on Esc' })).status).toBe(200);
    expect(cards(t.id).map((c) => c.status)).toEqual(['open']);
    // …and the person's own request for changes on the next round does close it
    await send(patch, { type: 'task.submit', taskId: t.id, artifacts: [{ kind: 'screenshot', name: 'after-esc.png' }], sha: 'a1b2c3d' });
    expect((await send(george, { type: 'task.request_changes', taskId: t.id, feedback: 'the drawer still jumps' })).status).toBe(200);
    expect(cards(t.id).map((c) => c.status)).toEqual(['dismissed']);
  });
});
