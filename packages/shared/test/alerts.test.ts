// The attention bar's derivation (docs/design/failure-alerts-2026-08): pure, so the Home bar
// and the bell section cannot disagree — and so every fold/ignore rule is pinned here.
import { describe, expect, it } from 'vitest';
import { alertsSummary, deriveAlerts, type AlertConnectorRow, type AlertPostRow, type AlertScheduleRow } from '../src/alerts';

const conn = (over: Partial<AlertConnectorRow> = {}): AlertConnectorRow => ({
  id: 'k1', provider: 'x', handle: '@joinflowe', status: 'reauth_required',
  project_id: 'p1', project_name: 'Flowe AI', channel_id: 'c1', ...over,
});
const sched = (over: Partial<AlertScheduleRow> = {}): AlertScheduleRow => ({
  id: 's1', title: 'Research flowe.ai competitors', status: 'active',
  last_error: 'no compute available — anthropic seats at their usage cap',
  last_run_at: '2026-08-19T02:00:00Z', channel_id: 'c1', channel_slug: 'marketing',
  project_id: 'p1', project_name: 'Flowe AI', ...over,
});
const post = (over: Partial<AlertPostRow> = {}): AlertPostRow => ({
  id: 'i1', platform: 'x', status: 'failed', last_error: 'x refused the image upload (403)',
  scheduled_at: '2026-08-19T15:45:00Z', channel_id: 'c1', channel_slug: 'marketing',
  project_id: 'p1', project_name: 'Flowe AI', ...over,
});

describe('deriveAlerts', () => {
  it('alerts on reauth_required and NEVER on a deliberate revoked — the whole reason 0121 exists', () => {
    const alerts = deriveAlerts([conn(), conn({ id: 'k2', status: 'revoked' }), conn({ id: 'k3', status: 'connected' })], [], []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'connector', key: 'connector:k1', channelId: 'c1', provider: 'x' });
    expect(alerts[0]!.title).toContain('@joinflowe');
  });

  it('a failing routine carries its verbatim last_error; paused rows stay silent (pausing IS the mute)', () => {
    const alerts = deriveAlerts([], [sched(), sched({ id: 's2', status: 'paused' }), sched({ id: 's3', last_error: null })], []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'routine', scheduleId: 's1', why: 'no compute available — anthropic seats at their usage cap' });
    expect(alerts[0]!.meta).toBe('Flowe AI · #marketing');
  });

  it('failed posts group per project × platform, and fold under a matching dead connector', () => {
    const alerts = deriveAlerts(
      [conn()],
      [],
      [post(), post({ id: 'i2' }), post({ id: 'i3', project_id: 'p2', project_name: 'Acme', channel_id: 'c9' })],
    );
    expect(alerts.map((a) => a.kind)).toEqual(['connector', 'posts', 'posts']);
    const folded = alerts.find((a) => a.kind === 'posts' && a.count === 2)!;
    expect(folded.linked).toBe(true);
    expect(folded.why).toContain('account above');
    const alone = alerts.find((a) => a.kind === 'posts' && a.count === 1)!;
    expect(alone.linked).toBe(false);
    expect(alone.why).toBe('x refused the image upload (403)'); // verbatim, never paraphrased
  });

  it('orders connector > routine > posts, and an empty world derives an empty bar', () => {
    const alerts = deriveAlerts([conn()], [sched()], [post()]);
    expect(alerts.map((a) => a.kind)).toEqual(['connector', 'routine', 'posts']);
    expect(deriveAlerts([], [], [])).toEqual([]);
    expect(alertsSummary(alerts)).toBe('X for Flowe AI needs re-authorizing · Research flowe.ai competitors failing · 1 post didn’t go out');
  });
});

describe('post-group dismissal (the watermark)', () => {
  const failed = (id: string, scheduledAt: string | null): AlertPostRow => ({
    id, platform: 'x', status: 'failed', last_error: 'x media upload failed', scheduled_at: scheduledAt,
    channel_id: 'ch1', channel_slug: 'marketing', project_id: 'p1', project_name: 'Flowe',
  });

  it('a dismissed group leaves the bar; a failure on a LATER slot re-raises it', () => {
    const posts = [failed('a', '2026-08-20T10:00:00Z'), failed('b', '2026-08-20T11:00:00Z')];
    const dismissed = deriveAlerts([], [], posts, { 'posts:p1:x': '2026-08-20T12:00:00Z' });
    expect(dismissed).toEqual([]); // seen, waved off — the calendar keeps the amber chips
    const later = deriveAlerts([], [], [...posts, failed('c', '2026-08-20T13:00:00Z')], { 'posts:p1:x': '2026-08-20T12:00:00Z' });
    expect(later).toHaveLength(1);
    expect(later[0]!.count).toBe(1); // only the NEW failure counts — the waved-off two stay off
  });

  it('a null scheduled_at never dismisses — an oddly-shaped failure keeps showing', () => {
    const out = deriveAlerts([], [], [failed('a', null)], { 'posts:p1:x': '2026-08-20T12:00:00Z' });
    expect(out).toHaveLength(1);
  });

  it('dismissals touch ONLY posts — a dead connector and a failing routine are not dismissible', () => {
    const conn: AlertConnectorRow = { id: 'c1', provider: 'x', handle: '@flowe', status: 'reauth_required', project_id: 'p1', project_name: 'Flowe', channel_id: 'ch1' };
    const sched: AlertScheduleRow = { id: 's1', title: 'Daily posts', status: 'active', last_error: 'boom', last_run_at: null, channel_id: 'ch1', channel_slug: 'marketing', project_id: 'p1', project_name: 'Flowe' };
    const out = deriveAlerts([conn], [sched], [], { 'connector:c1': '2999-01-01T00:00:00Z', 'routine:s1': '2999-01-01T00:00:00Z' });
    expect(out.map((a) => a.kind).sort()).toEqual(['connector', 'routine']);
  });
});

