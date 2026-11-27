// The Sales rules every side reads (plan round 5, DS3, DS5): the summary line and its tiles, the deals that need a
// move, and the money and day words.
import { describe, expect, it } from 'vitest';
import { dealNeedsMove, pipelineSummary, salesDay, salesMoney, type SalesDealRow } from './sales';

const deal = (stage: string, value: number, over: Partial<SalesDealRow> = {}): SalesDealRow => ({
  id: `${stage}-${value}`, workspace_id: 'w', contact_id: null, title: 'Deal', company: 'Acme', stage, value_year: value, currency: 'USD', next_step: 'Call', next_date: '2026-11-30',
  thread_id: null, moved_by_kind: null, moved_by: null, moved_at: null, closed_at: null, created_by_kind: 'human', created_by: 'g', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
});

describe('the Sales rules', () => {
  it('sums the open deals, the wins of this month and each tile, with Lost apart', () => {
    const s = pipelineSummary([deal('lead', 6000), deal('lead', 3600), deal('proposal', 18000), deal('won', 28800, { closed_at: '2026-11-12T15:00:00Z' }), deal('won', 5000, { closed_at: '2026-10-02T15:00:00Z' }), deal('lost', 4200)], new Date('2026-11-23T12:00:00'));
    expect([s.openValue, s.openCount, s.wonThisMonth]).toEqual([27600, 3, 28800]);
    expect(s.tiles.map((t) => [t.stage, t.count, t.value])).toEqual([['lead', 2, 9600], ['talked', 0, 0], ['trial', 0, 0], ['proposal', 1, 18000], ['won', 2, 33800]]);
    expect([s.lost.count, s.lost.value]).toEqual([1, 4200]);
  });
  it('says an open deal needs a move when its step is late or missing, and a closed deal never does', () => {
    expect(dealNeedsMove(deal('trial', 1, { next_date: '2026-11-20' }), '2026-11-23')).toBe('late');
    expect(dealNeedsMove(deal('trial', 1, { next_step: ' ' }), '2026-11-23')).toBe('none');
    expect(dealNeedsMove(deal('trial', 1), '2026-11-23')).toBeNull();
    expect(dealNeedsMove(deal('won', 1, { next_step: '' }), '2026-11-23')).toBeNull();
  });
  it('writes money and days in plain words', () => {
    expect(salesMoney(54000)).toBe('$54,000');
    expect(salesDay('2026-11-24')).toBe('Tue, Nov 24');
  });
});
