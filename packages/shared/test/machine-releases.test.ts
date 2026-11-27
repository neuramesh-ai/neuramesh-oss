import { describe, expect, it } from 'vitest';
import {
  cardMayShow, compareMachineVersions, freshWork, manifestProblem, mayUpgradeMachine, releasesSince, supportFloor, upgradeView, workIsIdle,
  workPhrase, type UpgradeViewInput,
} from '../src';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const OWNER = 'u-owner';

describe('machine release versions', () => {
  it('orders by number, not by text', () => {
    expect(compareMachineVersions('2026.11.10', '2026.11.9')).toBeGreaterThan(0);
    expect(compareMachineVersions('2026.10.4', '2026.11.1')).toBeLessThan(0);
    expect(compareMachineVersions('2026.11.3', '2026.11.3')).toBe(0);
    expect(compareMachineVersions('nonsense', '2026.01.1')).toBeLessThan(0);
  });

  it('lists the releases newer than the machine, newest first, and only the newest when the machine is unknown', () => {
    const rs = [{ version: '2026.10.9' }, { version: '2026.11.3' }, { version: '2026.11.1' }, { version: '2026.10.4' }];
    expect(releasesSince('2026.10.4', rs).map((r) => r.version)).toEqual(['2026.11.3', '2026.11.1', '2026.10.9']);
    expect(releasesSince(null, rs).map((r) => r.version)).toEqual(['2026.11.3']);
    expect(releasesSince('2026.11.3', rs)).toEqual([]);
  });
});

describe('who may upgrade (D2: anyone with access)', () => {
  it('a member machine is its owner alone, a runner is open to every person', () => {
    expect(mayUpgradeMachine('member', OWNER, OWNER)).toBe(true);
    expect(mayUpgradeMachine('member', OWNER, 'someone-else')).toBe(false);
    expect(mayUpgradeMachine('runner', OWNER, 'someone-else')).toBe(true);
    expect(mayUpgradeMachine('local', OWNER, OWNER)).toBe(false);
    expect(mayUpgradeMachine('runner', OWNER, null)).toBe(false);
  });
});

describe('idle for an upgrade', () => {
  it('is no turn, and no terminal input for 10 minutes', () => {
    expect(workIsIdle({ turns: [], terminals: 2, lastInputAt: 0 }, NOW)).toBe(true);
    expect(workIsIdle({ turns: [{ kind: 'agent' }], terminals: 0, lastInputAt: 0 }, NOW)).toBe(false);
    expect(workIsIdle({ turns: [], terminals: 1, lastInputAt: NOW - 60_000 }, NOW)).toBe(false);
    expect(workIsIdle({ turns: [], terminals: 1, lastInputAt: NOW - 11 * 60_000 }, NOW)).toBe(true);
    expect(workIsIdle(null, NOW)).toBe(false);
  });

  it('a work report older than 10 s tells nothing', () => {
    const w = { turns: [], terminals: 0, lastInputAt: 0 };
    expect(freshWork(w, NOW - 5_000, NOW)).toBe(w);
    expect(freshWork(w, NOW - 30_000, NOW)).toBeNull();
    expect(freshWork(w, null, NOW)).toBeNull();
  });
});

describe('the card shows a release', () => {
  const r = { securityDeadline: null, snoozedUntil: null, dismissedAt: null };
  it('not after ×, not while snoozed, and always for a security release', () => {
    expect(cardMayShow(r, NOW)).toBe(true);
    expect(cardMayShow({ ...r, dismissedAt: '2026-11-22T00:00:00Z' }, NOW)).toBe(false);
    expect(cardMayShow({ ...r, snoozedUntil: '2026-11-25T00:00:00Z' }, NOW)).toBe(false);
    expect(cardMayShow({ ...r, snoozedUntil: '2026-11-20T00:00:00Z' }, NOW)).toBe(true);
    expect(cardMayShow({ ...r, securityDeadline: '2026-12-02T00:00:00Z', dismissedAt: '2026-11-22T00:00:00Z' }, NOW)).toBe(true);
  });
});

describe('manifestProblem', () => {
  const feature = { id: 'faster-start', title: 'Your machine starts in half the time', text: 'A machine that sleeps is ready in about 25 seconds.', needsUpgrade: true };
  it('passes a good manifest', () => {
    expect(manifestProblem({ version: '2026.11.3', features: [feature] }, '2026.11.3')).toBeNull();
  });
  it('names each problem', () => {
    expect(manifestProblem({ version: '2026.11', features: [feature] })).toMatch(/YYYY/);
    expect(manifestProblem({ version: '2026.11.3', features: [feature] }, '2026.11.4')).toMatch(/does not match/);
    expect(manifestProblem({ version: '2026.11.3', features: [] })).toMatch(/empty/);
    expect(manifestProblem({ version: '2026.11.3', features: [{ ...feature, text: 'Fast; very fast.' }] })).toMatch(/semicolon/);
    expect(manifestProblem({ version: '2026.11.3', features: [{ ...feature, text: `${'word '.repeat(30)}.` }] })).toMatch(/25 words/);
    expect(manifestProblem({ version: '2026.11.3', features: [{ ...feature, media: { video: { dark: 'a.mp4' }, poster: { dark: 'a.jpg', light: 'b.jpg' }, alt: 'x' } }] })).toMatch(/dark and a light/);
    expect(manifestProblem({ version: '2026.11.3', features: [{ ...feature, needsUpgrade: 'yes' }] })).toMatch(/true or false/);
  });
});

describe('upgradeView', () => {
  const base: UpgradeViewInput = {
    kind: 'member', ownerUserId: OWNER, selfUserId: OWNER, power: 'off', version: '2026.10.4',
    newest: { version: '2026.11.3', securityDeadline: null }, upgrade: null, work: null, credits: true, held: false, offline: false, confirming: false,
  };
  const idle = { turns: [], terminals: 0, lastInputAt: 0 };
  const busy = { turns: [{ kind: 'agent' as const }, { kind: 'code' as const }], terminals: 1, lastInputAt: NOW };
  const acts = (i: Partial<UpgradeViewInput>) => upgradeView({ ...base, ...i }).buttons.map((b) => b.act);

  it('shows nothing to a person without access, and nothing on a current machine', () => {
    expect(upgradeView({ ...base, selfUserId: 'someone-else' }).show).toBe(false);
    expect(upgradeView({ ...base, version: '2026.11.3' }).state).toBe('current');
  });

  it('a stopped machine leads with Upgrade now, which starts it, and keeps the free next start quiet (D1)', () => {
    const v = upgradeView(base);
    expect(v.state).toBe('off');
    expect(v.title).toBe('Your machine is on 2026.10.4 and it is off');
    expect(v.buttons.map((b) => [b.act, b.label, b.kind])).toEqual([['start', 'Upgrade now', 'primary'], ['next_start', 'Upgrade at next start', 'ghost'], ['later', 'Later', 'quiet']]);
    expect(v.line).toBe('Upgrade now starts it on 2026.11.3. This takes about 1 minute. The machine uses credits until it sleeps again.');
  });

  it('an upgrade that waits for the next start can start now, unless the start cannot happen', () => {
    const staged = { ...base, upgrade: { mode: 'next_start' as const, state: 'staged' as const, toVersion: '2026.11.3' } };
    const v = upgradeView(staged);
    expect(v.buttons.map((b) => [b.act, b.label, b.kind])).toEqual([['start', 'Upgrade now', 'primary'], ['cancel', 'Cancel the upgrade', 'ghost']]);
    expect(v.line).toBe('Your machine stays off. It starts on 2026.11.3 the next time it wakes. The machine uses credits until it sleeps again.');
    expect(upgradeView({ ...staged, upgrade: { ...staged.upgrade, mode: 'forced' } }).buttons[0]!.act).toBe('start');
    for (const no of [{ credits: false }, { held: true }, { offline: true }]) {
      const w = upgradeView({ ...staged, ...no });
      expect([w.state, w.buttons.map((b) => b.act), w.line]).toEqual(['staged', ['cancel'], 'Your machine stays off. It starts on 2026.11.3 the next time it wakes.']);
    }
  });

  it('a start from off shows three steps, with no save, and moves with the server\'s step', () => {
    const start = (step: number) => upgradeView({ ...base, power: 'waking', upgrade: { mode: 'start', state: 'booting', toVersion: '2026.11.3', step } });
    expect(start(1).steps).toEqual(['Start on 2026.11.3', 'Restore your work', 'Join the relay']);
    expect([start(1).step, start(2).step, start(3).step]).toEqual([0, 1, 2]);
    expect(upgradeView({ ...base, power: 'waking', upgrade: { mode: 'next_start', state: 'booting', toVersion: '2026.11.3', step: 1 } }).steps).toHaveLength(3);
    expect(upgradeView({ ...base, power: 'waking', upgrade: { mode: 'now', state: 'draining', toVersion: '2026.11.3', step: 0 } }).steps).toHaveLength(4);
  });

  it('with no credits a stopped machine offers only the free choice', () => {
    expect(upgradeView({ ...base, credits: false }).state).toBe('nocredit');
    expect(acts({ credits: false })).toEqual(['next_start', 'later']);
  });

  it('an idle machine offers Upgrade now, and says which terminals close', () => {
    const v = upgradeView({ ...base, power: 'on', work: { ...idle, terminals: 2 } });
    expect(v.state).toBe('idle');
    expect(v.line).toContain('Your 2 open terminals close.');
    expect(v.buttons[0]!.act).toBe('now');
  });

  it('a busy machine waits by default, and its Upgrade now asks first', () => {
    expect(upgradeView({ ...base, power: 'on', work: busy }).state).toBe('busy');
    expect(acts({ power: 'on', work: busy })).toEqual(['when_idle', 'confirm', 'later']);
    const c = upgradeView({ ...base, power: 'on', work: busy, confirming: true });
    expect(c.state).toBe('confirm');
    expect(c.title).toBe('Stop 2 agent turns and 1 terminal?');
    expect(c.buttons.map((b) => [b.act, b.kind])).toEqual([['stop_and_upgrade', 'danger'], ['cancel_confirm', 'ghost']]);
  });

  it('an awake machine with no work report counts as busy', () => {
    expect(upgradeView({ ...base, power: 'on', work: null }).state).toBe('busy');
  });

  it('armed, staged, in progress, success and failure', () => {
    expect(upgradeView({ ...base, power: 'on', upgrade: { mode: 'when_idle', state: 'armed', toVersion: '2026.11.3' } }).state).toBe('armed');
    expect(upgradeView({ ...base, upgrade: { mode: 'next_start', state: 'staged', toVersion: '2026.11.3' } }).state).toBe('staged');
    const run = upgradeView({ ...base, power: 'waking', upgrade: { mode: 'now', state: 'booting', toVersion: '2026.11.3', step: 2 } });
    expect([run.state, run.step, run.steps[1]]).toEqual(['run', 2, 'Start on 2026.11.3']);
    expect(upgradeView({ ...base, power: 'on', version: '2026.11.3', upgrade: { mode: 'now', state: 'ready', toVersion: '2026.11.3' } }).state).toBe('ok');
    const fail = upgradeView({ ...base, power: 'on', upgrade: { mode: 'now', state: 'rolled_back', toVersion: '2026.11.3', reason: 'BOOT_NOT_READY' } });
    expect([fail.state, fail.line]).toEqual(['fail', 'Your machine is back on 2026.10.4. Your work is safe. Nothing changed.']);
    const lost = upgradeView({ ...base, power: 'on', upgrade: { mode: 'now', state: 'failed', toVersion: '2026.11.3', reason: 'DRAIN_TIMEOUT' } });
    expect(lost.line).not.toContain('Your work is safe');
  });

  it('a success offers Return to the last version only when the server names one (plan §8.4)', () => {
    const ok = { ...base, power: 'on' as const, version: '2026.11.3', upgrade: { mode: 'now' as const, state: 'ready' as const, toVersion: '2026.11.3', fromVersion: '2026.10.4' } };
    expect(acts(ok)).toEqual(['close']);
    const v = upgradeView({ ...ok, returnTo: '2026.10.4' });
    expect(v.buttons.map((b) => [b.act, b.label, b.kind])).toEqual([['close', 'Close', 'secondary'], ['return', 'Return to 2026.10.4', 'quiet']]);
  });

  it('a return to the last version says Return, also while it waits on a current machine', () => {
    const back = { mode: 'now' as const, toVersion: '2026.10.4', fromVersion: '2026.11.3' };
    expect(upgradeView({ ...base, power: 'waking', version: '2026.11.3', upgrade: { ...back, state: 'booting', step: 1 } }).title).toBe('Return to 2026.10.4');
    const armed = upgradeView({ ...base, power: 'on', version: '2026.11.3', work: busy, upgrade: { ...back, mode: 'when_idle', state: 'armed' } });
    expect([armed.state, armed.title]).toEqual(['armed', 'Return to 2026.10.4 when idle']);
    const staged = upgradeView({ ...base, version: '2026.11.3', upgrade: { ...back, mode: 'next_start', state: 'staged' } });
    expect([staged.state, staged.line]).toEqual(['staged', 'Your machine stays off. It starts on 2026.10.4 the next time it wakes. The machine uses credits until it sleeps again.']);
    expect(staged.buttons[0]!.label).toBe('Return now');
    expect(upgradeView({ ...base, power: 'on', version: '2026.10.4', upgrade: { ...back, state: 'ready' }, returnTo: null }).state).toBe('ok');
  });

  it('a security release has no Later', () => {
    const sec = { ...base, newest: { version: '2026.11.4', securityDeadline: '2026-12-02T12:00:00Z' } };
    expect(upgradeView(sec).buttons.map((b) => b.act)).not.toContain('later');
    expect(upgradeView({ ...sec, power: 'on', work: idle }).buttons.map((b) => b.act)).toEqual(['now', 'when_idle']);
    expect(upgradeView(sec).security).toBe(true);
  });

  it('offline and held say so in one sentence, with no button', () => {
    expect(upgradeView({ ...base, offline: true }).buttons).toEqual([]);
    expect(upgradeView({ ...base, held: true }).state).toBe('held');
  });

  it('every word follows STE: no em dash and no semicolon', () => {
    const inputs: Partial<UpgradeViewInput>[] = [{}, { credits: false }, { power: 'on', work: idle }, { power: 'on', work: busy }, { power: 'on', work: busy, confirming: true },
      { upgrade: { mode: 'next_start', state: 'staged', toVersion: '2026.11.3' } }];
    for (const i of inputs) {
      const v = upgradeView({ ...base, ...i });
      expect(`${v.title} ${v.line} ${v.buttons.map((b) => b.label).join(' ')}`).not.toMatch(/[—;]/);
    }
    expect(workPhrase({ turns: [{ kind: 'agent' }], terminals: 0, lastInputAt: 0 })).toBe('1 agent turn');
  });
});

describe('supportFloor (D4: 30 days, never fewer than the newest three)', () => {
  const day = 86_400_000;
  const NOW2 = Date.parse('2026-12-31T00:00:00Z');
  const rel = (version: string, daysAgo: number) => ({ version, publishedAt: NOW2 - daysAgo * day });
  it('keeps every release of the last 30 days', () => {
    const rs = [rel('2026.12.4', 1), rel('2026.12.3', 5), rel('2026.12.2', 10), rel('2026.12.1', 20), rel('2026.11.9', 40), rel('2026.11.5', 60)];
    expect(supportFloor(rs, null, NOW2)).toBe('2026.12.1');
  });
  it('never fewer than the newest three, and no floor while every release is kept', () => {
    const rs = [rel('2026.12.1', 50), rel('2026.11.9', 70), rel('2026.11.5', 90), rel('2026.10.2', 120)];
    expect(supportFloor(rs, null, NOW2)).toBe('2026.11.5');
    expect(supportFloor(rs.slice(0, 3), null, NOW2)).toBeNull();
  });
  it('an ops floor above the window wins, below it does not', () => {
    const rs = [rel('2026.12.4', 1), rel('2026.12.3', 2), rel('2026.12.2', 3), rel('2026.11.1', 50)];
    expect(supportFloor(rs, '2026.12.3', NOW2)).toBe('2026.12.3');
    expect(supportFloor(rs, '2026.10.1', NOW2)).toBe('2026.12.2');
  });
});
