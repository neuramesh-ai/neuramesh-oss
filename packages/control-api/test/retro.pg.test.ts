// Retro aggregation against the REAL schema (docs/13): a realistic week — two
// accepted tasks (one with a correction round), a review bounce, a lesson, a
// proposed skill — then asserts the exact aggregates, derived levels, and the
// denominator floors. Runs in its OWN workspace so the other pg suites' tasks
// can't pollute the numbers. Run via scripts/test-pg.sh.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';
import { computeRetro } from '../src/retro';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

function getRetro(workspace: string, range: string) {
  return app!.request(`/v1/retro?workspace=${workspace}&range=${range}`, {
    headers: { 'x-nm-actor': JSON.stringify(george) },
  });
}

describe.skipIf(!DB)('retro aggregation (docs/13, real schema)', () => {
  it('derives every number from events/tasks/facts/skills — exactly', async () => {
    const ws = await j(await send(george, { type: 'workspace.create', name: 'Retro Lab', slug: 'retro-lab' }));
    const WS: string = ws.workspaceId;
    expect(WS).toBeTruthy();

    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'retro-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const wReg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'patchy', role: 'worker', channels: ['general'] }));
    const rReg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'gemma', role: 'reviewer', channels: ['general'] }));
    const patch: Actor = { kind: 'agent', id: wReg.agentId, role: 'worker' };
    const gem: Actor = { kind: 'agent', id: rReg.agentId, role: 'reviewer' };

    const walk = async (title: string, bounce: boolean) => {
      const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'general', title }));
      expect((await send(patch, { type: 'task.claim', taskId: task.id })).status).toBe(200);
      await send(patch, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['retro fixture'] });
      await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'out.md', content: '# v1' }] });
      if (bounce) {
        expect((await send(gem, { type: 'task.request_changes', taskId: task.id, feedback: 'fix the empty state copy' })).status).toBe(200);
        await send(patch, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'doc', name: 'out2.md', content: '# v2' }] });
      }
      expect((await send(gem, { type: 'task.approve', taskId: task.id })).status).toBe(200);
      expect((await send(george, { type: 'task.accept', taskId: task.id })).status).toBe(200);
      return task;
    };

    await walk('clean first-try task', false);
    const b = await walk('corrected task', true);

    expect(
      (await send(gem, { type: 'memory.record_lesson', workspace: WS, channel: 'general', content: 'verify empty states before submitting UI work', taskId: b.id })).status,
    ).toBe(200);
    expect(
      (await send(patch, { type: 'skill.propose', workspace: WS, channel: 'general', name: 'empty-state-check', description: 'verify empty states before submit', body: '# empty-state-check\nWalk every empty state.' })).status,
    ).toBe(200);

    const res = await getRetro(WS, 'week');
    expect(res.status).toBe(200);
    const retro = await j(res);

    // org row — all from lifecycle stamps + facts
    expect(retro.org.accepted).toBe(2);
    expect(retro.org.lessons).toBe(1);
    expect(retro.org.avgCycleMs).toBeGreaterThan(0);
    expect(retro.org.leveledUp).toBe(1);

    const patchy = retro.agents.find((x: any) => x.name === 'patchy');
    const gemma = retro.agents.find((x: any) => x.name === 'gemma');
    expect(patchy).toBeTruthy();
    expect(gemma).toBeTruthy();

    // worker headline: 1 of 2 approvals were first-try — UNDER the denominator
    // floor, so no percentage is claimed (docs/13 §3)
    expect(patchy.headline.kind).toBe('firstTry');
    expect(patchy.headline).toMatchObject({ n: 1, d: 2, rate: null, deltaPoints: null });
    expect(patchy.counts).toMatchObject({ accepted: 2, lessons: 1, skillsProposed: 1 });
    expect(patchy.spark.reduce((s: number, n: number) => s + n, 0)).toBe(2);
    expect(patchy.learned).toContain('empty states');

    // reviewer: 3 review actions (2 approvals + 1 correction), 1 caught
    expect(gemma.headline.kind).toBe('caught');
    expect(gemma.headline.n).toBe(1);
    expect(gemma.headline.d).toBe(3);
    expect(gemma.counts.reviews).toBe(3);

    // levels re-derive from history: patchy 2·10 + 1·2 + 1·5 = 27xp → lv1,
    // crossed within this window; gemma 3·3 = 9xp → still lv0
    expect(patchy.xp).toBe(27);
    expect(patchy.level).toBe(1);
    expect(patchy.leveledUp).toBe(true);
    expect(gemma.xp).toBe(9);
    expect(gemma.level).toBe(0);
    expect(gemma.leveledUp).toBe(false);

    // compounding curve: the current trailing week holds 2 approvals, 1 clean —
    // under the floor, the bar stays a gap instead of pretending 50% is signal
    const wk = retro.curve[7];
    expect(wk.d).toBe(2);
    expect(wk.n).toBe(1);
    expect(wk.rate).toBeNull();

    // lessons list carries provenance: content + task number + learner (assignee)
    expect(retro.lessons).toHaveLength(1);
    expect(retro.lessons[0].taskNumber).toBe(b.number);
    expect(retro.lessons[0].learner).toBe('patchy');

    // the prior window is empty — rolling windows don't leak
    const last = await j(await getRetro(WS, 'lastweek'));
    expect(last.org.accepted).toBe(0);
    expect(last.agents.find((x: any) => x.name === 'patchy').counts.accepted).toBe(0);

    // bad range is a 400, not a default
    expect((await getRetro(WS, 'fortnight')).status).toBe(400);
  }, 30_000);

  // Regression guard for the timezone spark-bucket drop (docs/13 §3). The retro
  // window is anchored to LOCAL midnight, but the spark used to bucket by
  // absolute UTC day — so on a UTC-behind machine an evening event on the last
  // window day landed one bucket past the array and was silently dropped. This
  // reproduced only when run after ~17:00 local; here we pin it deterministically
  // by feeding computeRetro a fixed non-UTC-midnight dayStart (07:00Z == local
  // midnight in UTC-7) and backdated accepted_at instants, so it fails at ANY
  // wall-clock hour if bucketing regresses to absolute UTC days.
  it('sparks by local day, not UTC day — last-day evening events are not dropped', async () => {
    const H = 3_600_000;
    const DAY = 86_400_000;
    const dayStart = Date.parse('2026-06-15T07:00:00.000Z'); // local midnight, UTC-7
    const from = dayStart - 6 * DAY; //   window start  2026-06-09T07:00Z (day 0, 00:00 local)
    const to = dayStart + DAY; //         window end    2026-06-16T07:00Z (exclusive)
    const tMidday = from + 12 * H; //     day 0, 12:00 local            → bucket 0
    const tLastEve = to - 30 * 60_000; // day 6, 23:30 local (06:30Z)   → bucket 6, NOT 7

    const ws = await j(await send(george, { type: 'workspace.create', name: 'Spark TZ', slug: 'spark-tz' }));
    const WS: string = ws.workspaceId;
    const mach = await j(await send(george, { type: 'machine.register', workspace: WS, name: 'tz-rig', platform: 'darwin', daemonVersion: '0.1.0' }));
    const reg = await j(await send(george, { type: 'agent.register', workspace: WS, machineId: mach.machineId, name: 'nightowl', role: 'worker', channels: ['general'] }));
    const owlId: string = reg.agentId;

    const seed = async (title: string): Promise<string> => {
      const { task } = await j(await send(george, { type: 'task.create', workspace: WS, channel: 'general', title }));
      return task.id as string;
    };
    const a = await seed('day-0 midday');
    const b = await seed('last-day 23:30 local');

    // Backdate directly: the spark aggregates on assignee_kind='agent' + accepted_at,
    // independent of FSM state, so a raw set is the minimal deterministic fixture.
    const sql = postgres(DB!, { prepare: false, onnotice: () => {} });
    try {
      await sql`update tasks set assignee_kind = 'agent', assignee_id = ${owlId}::uuid, accepted_at = ${new Date(tMidday).toISOString()} where id = ${a}::uuid`;
      await sql`update tasks set assignee_kind = 'agent', assignee_id = ${owlId}::uuid, accepted_at = ${new Date(tLastEve).toISOString()} where id = ${b}::uuid`;

      const retro = await computeRetro(sql, WS, 'week', dayStart);
      const owl = retro.agents.find((x) => x.name === 'nightowl');
      expect(owl).toBeTruthy();
      // 7 daily buckets; both events counted, the 23:30-local one in the FINAL bucket
      expect(owl!.spark).toEqual([1, 0, 0, 0, 0, 0, 1]);
    } finally {
      await sql.end();
    }
  }, 30_000);
});
